import json
from unittest.mock import Mock
import httpx
import pytest
from pydantic import ValidationError
from contentops.agents import AgentRunner, ProviderFailure, request_with_retry, strict_schema
from contentops.gemini import GeminiClient
from contentops.models import Article, Research


def response(text='{"title":"Article","markdown":"# Planned beta"}', grounding=None, finish="STOP"):
    candidate = {"finishReason": finish, "content": {"parts": [{"text": "private thought", "thought": True}, {"text": text}]}}
    if grounding is not None:
        candidate["groundingMetadata"] = grounding
    return {"candidates": [candidate], "usageMetadata": {"promptTokenCount": 100, "candidatesTokenCount": 30, "thoughtsTokenCount": 20}}


def runner_for(payload, requests=None):
    def handler(request):
        if requests is not None:
            requests.append(request)
        return httpx.Response(200, json=payload)
    return AgentRunner(GeminiClient("test-key", httpx.MockTransport(handler)), provider="gemini")


def test_gemini_real_crewai_task_uses_native_api_and_validates_json():
    requests = []
    runner = runner_for(response(), requests)
    runner.begin([], "draft")
    assert runner.task("draft", "Write", Article).title == "Article"
    assert len(requests) == 1
    request = requests[0]
    assert request.url.host == "generativelanguage.googleapis.com"
    assert request.headers["x-goog-api-key"] == "test-key"
    assert "test-key" not in str(request.url)
    body = json.loads(request.content)
    assert body["store"] is False
    assert body["generationConfig"]["responseMimeType"] == "application/json"
    assert body["generationConfig"]["responseJsonSchema"]["additionalProperties"] is False
    assert runner.usage.input_tokens == 100
    assert runner.usage.output_tokens == 50


def test_grounding_uses_provider_metadata_and_preserves_search_suggestions():
    requests = []
    grounding = {"webSearchQueries": ["content workflows"], "groundingChunks": [
        {"web": {"uri": "https://example.com/evidence", "title": "Evidence"}},
        {"web": {"uri": "javascript:bad", "title": "Unsafe"}},
    ], "searchEntryPoint": {"renderedContent": '<a href="https://google.com/search?q=content">Search</a>'}}
    runner = runner_for(response("Research. Invented URL: https://fake.example", grounding), requests)
    runner.begin([], "research")
    runner.search("content workflows")
    assert [s["url"] for s in runner.sources] == ["https://example.com/evidence"]
    assert "Search</a>" in runner.sources[0]["searchEntryPoint"]
    assert runner.usage.search_calls == 1
    assert json.loads(requests[0].content)["tools"] == [{"google_search": {}}]
    runner.search("content workflows")
    assert len(runner.sources) == 1


def test_search_cannot_pass_without_grounded_source_metadata():
    runner = runner_for(response("Trust me: https://fake.example"))
    runner.begin([], "research")
    with pytest.raises(ProviderFailure, match="incomplete"):
        runner.search("public topic")
    assert runner.sources == []


@pytest.mark.parametrize("payload", [response(finish="MAX_TOKENS"), {"promptFeedback": {"blockReason": "SAFETY"}}])
def test_incomplete_and_blocked_results_are_rejected(payload):
    runner = runner_for(payload)
    runner.begin([], "draft")
    with pytest.raises(ProviderFailure, match="complete structured result"):
        runner.task("draft", "Write", Article)


def test_invalid_structured_output_is_not_accepted():
    runner = runner_for(response('{"unexpected":"value"}'))
    runner.begin([], "draft")
    with pytest.raises(ValidationError):
        runner.task("draft", "Write", Article)


@pytest.mark.parametrize("status,expected_calls", [(429,3),(503,3),(400,1),(401,1)])
def test_native_http_errors_follow_bounded_retry_policy(status, expected_calls):
    handler = Mock(return_value=httpx.Response(status, json={"error": "private details"}))
    client = GeminiClient("test-key", httpx.MockTransport(handler))
    with pytest.raises(ProviderFailure) as error:
        request_with_retry(lambda: client.create(model="gemini-2.5-flash",instructions="policy",input="private PRD",max_output_tokens=10), sleep=Mock())
    assert handler.call_count == expected_calls
    assert "private" not in str(error.value)


def test_gemini_does_not_require_openai_key_and_uses_own_model_and_prices(monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.setenv("GEMINI_API_KEY", "gemini-key")
    monkeypatch.setenv("GEMINI_MODEL_WRITER", "gemini-custom")
    for suffix in ("INPUT_PRICE_PER_MILLION", "OUTPUT_PRICE_PER_MILLION", "SEARCH_PRICE_PER_CALL"):
        monkeypatch.setenv("GEMINI_" + suffix, "0")
        monkeypatch.setenv("OPENAI_" + suffix, "100")
    runner = AgentRunner(provider="gemini")
    runner.begin([], "draft")
    assert isinstance(runner.client, GeminiClient)
    assert runner.model == "gemini-custom"
    assert runner.finish_usage().cost_usd == 0


def test_missing_selected_key_does_not_fall_back(monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.setenv("OPENAI_API_KEY", "openai-key")
    with pytest.raises(ProviderFailure, match="GEMINI_API_KEY"):
        AgentRunner(provider="gemini").begin([], "draft")


def test_native_timeouts_are_retried_without_leaking_input():
    handler = Mock(side_effect=lambda request: (_ for _ in ()).throw(httpx.ReadTimeout("private input", request=request)))
    client = GeminiClient("test-key", httpx.MockTransport(handler))
    with pytest.raises(ProviderFailure, match="timed out"):
        request_with_retry(lambda: client.create(model="gemini-2.5-flash",instructions="policy",input="private PRD",max_output_tokens=10), sleep=Mock())
    assert handler.call_count == 3


def test_nullable_source_metadata_keeps_openai_strict_schema_valid():
    source = strict_schema(Research)["$defs"]["Source"]
    assert "searchEntryPoint" in source["required"]
    assert "default" not in source["properties"]["searchEntryPoint"]
