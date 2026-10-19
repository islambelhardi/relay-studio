"""Gemini generateContent adapter for structured tasks and grounded research.

Uses the native Google API; the existing OpenAI SDK is only used for common
exception types consumed by the worker's bounded retry policy.
"""
import re
from types import SimpleNamespace
import httpx
from openai import APIConnectionError, APITimeoutError, APIStatusError


class GeminiClient:
    def __init__(self, api_key: str, transport=None):
        self.api_key = api_key
        self.transport = transport
        self.responses = self

    def create(self, *, model, instructions, input, max_output_tokens, text=None,
               tools=None, **kwargs):
        if not re.fullmatch(r"[A-Za-z0-9._-]+", model):
            raise ValueError("Invalid Gemini model identifier")
        body = {
            "systemInstruction": {"parts": [{"text": instructions}]},
            "contents": [{"role": "user", "parts": [{"text": input}]}],
            "generationConfig": {"maxOutputTokens": max_output_tokens},
            "store": False,
        }
        if text:
            body["generationConfig"].update({
                "responseMimeType": "application/json",
                "responseJsonSchema": text["format"]["schema"],
            })
        if tools:
            body["tools"] = [{"google_search": {}}]
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
        try:
            # Keep the key in a header, never in a logged URL.
            with httpx.Client(timeout=90, transport=self.transport) as client:
                response = client.post(url, headers={"x-goog-api-key": self.api_key}, json=body)
                response.raise_for_status()
        except httpx.TimeoutException as exc:
            raise APITimeoutError(request=exc.request) from None
        except httpx.RequestError as exc:
            raise APIConnectionError(request=exc.request) from None
        except httpx.HTTPStatusError as exc:
            raise APIStatusError("Gemini request failed", response=exc.response, body=None) from None
        data = response.json()
        candidate = (data.get("candidates") or [{}])[0]
        output_text = "".join(part.get("text", "") for part in candidate.get("content", {}).get("parts", []) if not part.get("thought"))
        grounding = candidate.get("groundingMetadata") or {}
        sources = [chunk["web"] for chunk in grounding.get("groundingChunks", []) if chunk.get("web", {}).get("uri")]
        queries = grounding.get("webSearchQueries") or []
        output = []
        if tools and (queries or sources):
            # Native grounding metadata is the only authority for source URLs.
            metadata = [{"url": s["uri"], "title": s.get("title") or s["uri"]} for s in sources]
            output.append(SimpleNamespace(type="web_search_call", action=SimpleNamespace(model_dump=lambda: {"sources": metadata})))
        usage = data.get("usageMetadata") or {}
        completed = candidate.get("finishReason") == "STOP" and bool(output_text)
        if tools and not sources:
            completed = False
        return SimpleNamespace(
            status="completed" if completed else "incomplete",
            output_text=output_text,
            output=output,
            search_entry_point=(grounding.get("searchEntryPoint") or {}).get("renderedContent"),
            # Thinking tokens also consume output quota and can be billable.
            usage=SimpleNamespace(input_tokens=usage.get("promptTokenCount", 0),
                                  output_tokens=usage.get("candidatesTokenCount", 0) + usage.get("thoughtsTokenCount", 0)),
        )
