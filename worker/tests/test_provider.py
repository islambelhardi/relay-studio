from types import SimpleNamespace
from unittest.mock import Mock
import httpx
import pytest
from openai import APITimeoutError, BadRequestError
from contentops.agents import AgentRunner, ProviderFailure, request_with_retry
from contentops.models import Article
from pydantic import ValidationError

def test_transient_retry_is_bounded():
    op = Mock(side_effect=APITimeoutError(request=httpx.Request("POST","https://api.openai.com/v1/responses")))
    retry, sleep = Mock(), Mock()
    with pytest.raises(ProviderFailure):
        request_with_retry(op,retry,sleep)
    assert op.call_count == 3 and retry.call_count == 2
    assert [c.args[0] for c in sleep.call_args_list] == [1,2]

def test_non_transient_request_does_not_retry():
    response = httpx.Response(400,request=httpx.Request("POST","https://api.openai.com/v1/responses"))
    op = Mock(side_effect=BadRequestError("invalid",response=response,body={}))
    with pytest.raises(ProviderFailure):
        request_with_retry(op,sleep=Mock())
    assert op.call_count == 1

def test_real_crewai_agent_uses_responses_and_validated_schema():
    client = Mock()
    client.responses.create.return_value = SimpleNamespace(status="completed", output_text='{"title":"Test article","markdown":"# Planned beta"}', usage=SimpleNamespace(input_tokens=100,output_tokens=30),output=[])
    runner = AgentRunner(client)
    runner.begin([],"draft")
    result = runner.task("draft","Write the article",Article)
    assert result.title == "Test article"
    assert runner.usage.input_tokens == 100
    assert client.responses.create.call_count == 1
    request = client.responses.create.call_args.kwargs
    assert request["store"] is False
    assert request["text"]["format"]["strict"] is True

def test_real_agent_propagates_invalid_output_without_extra_calls():
    client = Mock()
    client.responses.create.return_value = SimpleNamespace(status="completed",output_text='{"unexpected":"shape"}',usage=SimpleNamespace(input_tokens=100,output_tokens=10),output=[])
    runner = AgentRunner(client)
    runner.begin([],"draft")
    with pytest.raises(ValidationError):
        runner.task("draft","Write an article",Article)
    assert client.responses.create.call_count == 1
    assert runner.usage.input_tokens == 100

def test_real_agent_propagates_permanent_provider_failure():
    client = Mock()
    response = httpx.Response(400,request=httpx.Request("POST","https://api.openai.com/v1/responses"))
    client.responses.create.side_effect = BadRequestError("invalid",response=response,body={})
    runner = AgentRunner(client)
    runner.begin([],"draft")
    with pytest.raises(ProviderFailure):
        runner.task("draft","Write an article",Article)
    assert client.responses.create.call_count == 1
