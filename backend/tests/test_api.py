from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health():
    assert client.get("/api/health").json() == {"status": "ok"}


def test_meta():
    body = client.get("/api/meta").json()
    assert body["deliveryStart"] == "2026-01-02"
    assert body["deliveryEnd"] == "2026-02-01"
    assert body["forecastPublishTimes"]


def test_day_ahead_on_snapshot():
    body = client.get("/api/day-ahead", params={"delivery_date": "2026-01-15"}).json()
    assert body["decisionCutoff"] == "2026-01-14T11:00:00Z"
    assert len(body["slots"]) == 24
    assert all(s["publishTime"] <= body["decisionCutoff"] for s in body["slots"])


def test_day_ahead_rejects_out_of_scope_date():
    assert client.get("/api/day-ahead", params={"delivery_date": "2025-06-01"}).status_code == 404


def test_cutoff_hour_validation():
    r = client.get("/api/day-ahead", params={"delivery_date": "2026-01-15", "cutoff_hour": 30})
    assert r.status_code == 422


def test_accuracy_and_horizon():
    acc = client.get("/api/accuracy").json()
    assert acc["overall"]["n"] > 700
    assert len(acc["daily"]) == 31
    assert client.get("/api/horizon").json()[0]["leadFromHours"] == 0


def test_vintages():
    body = client.get("/api/vintages", params={"delivery_date": "2026-01-15"}).json()
    assert any(v["afterCutoff"] for v in body["vintages"])
    assert any(not v["afterCutoff"] for v in body["vintages"])
