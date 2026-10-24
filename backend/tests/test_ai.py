import pytest
from fastapi.testclient import TestClient

from app import ai
from app.main import app

client = TestClient(app)


def test_tool_loop_executes_tools_and_returns_text(monkeypatch):
    calls = []

    def fake_gemini(contents, system):
        calls.append(contents)
        if len(calls) == 1:
            fc = {"name": "get_day_ahead", "args": {"delivery_date": "2026-01-15"}}
            return {"candidates": [{"content": {"role": "model", "parts": [{"functionCall": fc}]}}]}
        tool_result = contents[-1]["parts"][0]["functionResponse"]["response"]
        text = f"MAE was {tool_result['elexonForecastErrors']['maeMW']} MW"
        return {"candidates": [{"content": {"role": "model", "parts": [{"text": text}]}}]}

    monkeypatch.setattr(ai, "_call_gemini", fake_gemini)
    out = ai.chat([{"role": "user", "content": "How was the 15th?"}], "2026-01-15", 11)
    assert out["reply"].startswith("MAE was ")
    assert out["toolCalls"] == [{"name": "get_day_ahead", "args": {"delivery_date": "2026-01-15"}}]
    # Model's function-call turn is echoed back before the tool response.
    assert calls[1][-2]["parts"][0]["functionCall"]["name"] == "get_day_ahead"


def test_tool_errors_are_returned_to_model_not_raised():
    assert "error" in ai._run_tool("get_day_ahead", {"delivery_date": "2025-06-01"})
    assert "error" in ai._run_tool("nope", {})


@pytest.mark.parametrize(
    "name,args",
    [
        ("get_day_ahead", {"delivery_date": "2026-01-15"}),
        ("get_accuracy_summary", {}),
        ("get_daily_table", {}),
        ("get_lead_time_errors", {}),
        ("get_forecast_runs", {"delivery_date": "2026-01-15"}),
    ],
)
def test_every_tool_runs_on_snapshot(name, args):
    assert "error" not in ai._run_tool(name, args)


def test_chat_endpoint_without_key_returns_503(monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    r = client.post("/api/ai/chat", json={"messages": [{"role": "user", "content": "hi"}]})
    assert r.status_code == 503


def test_chat_endpoint_validates_input():
    assert client.post("/api/ai/chat", json={"messages": []}).status_code == 422
