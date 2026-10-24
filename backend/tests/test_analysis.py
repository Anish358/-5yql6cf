import math
from datetime import date

import pytest

from app import analysis as A


def _fc(publish: str, start: str, mw: float) -> dict:
    return {"publishTime": publish, "startTime": start, "generation": mw}


def _ds() -> A.Dataset:
    actuals = [
        {"startTime": "2026-01-15T00:00:00Z", "generation": 1000},
        {"startTime": "2026-01-15T00:30:00Z", "generation": 1100},
        {"startTime": "2026-01-15T01:00:00Z", "generation": 2000},
    ]
    forecasts = [
        # Published before the 11:00 D-1 gate closure.
        _fc("2026-01-14T07:30:00Z", "2026-01-15T00:00:00Z", 900),
        _fc("2026-01-14T09:30:00Z", "2026-01-15T00:00:00Z", 1200),
        _fc("2026-01-14T09:30:00Z", "2026-01-15T01:00:00Z", 1500),
        # Published after gate closure: must be ignored for the day-ahead decision.
        _fc("2026-01-14T11:30:00Z", "2026-01-15T00:00:00Z", 5000),
    ]
    return A.Dataset(actuals, forecasts)


def test_latest_forecast_respects_cutoff():
    ds = _ds()
    t = A.parse_ts("2026-01-15T00:00:00Z")
    assert ds.latest_forecast(t, A.parse_ts("2026-01-14T11:00:00Z")).generation == 1200
    assert ds.latest_forecast(t, A.parse_ts("2026-01-14T08:00:00Z")).generation == 900
    assert ds.latest_forecast(t, A.parse_ts("2026-01-14T00:00:00Z")) is None


def test_publish_exactly_at_cutoff_is_included():
    ds = _ds()
    t = A.parse_ts("2026-01-15T00:00:00Z")
    assert ds.latest_forecast(t, A.parse_ts("2026-01-14T09:30:00Z")).generation == 1200


def test_decision_cutoff_is_previous_day_uk_time():
    assert A.fmt_ts(A.decision_cutoff(date(2026, 1, 15), 11)) == "2026-01-14T11:00:00Z"
    # During BST the UK cutoff is one hour earlier in UTC.
    assert A.fmt_ts(A.decision_cutoff(date(2026, 7, 15), 11)) == "2026-07-14T10:00:00Z"


def test_delivery_hours_handles_dst_days():
    assert len(A.delivery_hours(date(2026, 1, 15))) == 24
    assert len(A.delivery_hours(date(2026, 3, 29))) == 23
    assert len(A.delivery_hours(date(2026, 10, 25))) == 25


def test_day_ahead_view_uses_pre_cutoff_forecast_and_signs_error():
    view = A.day_ahead_view(_ds(), date(2026, 1, 15), 11)
    first, second = view["slots"][0], view["slots"][1]
    assert first["forecast"] == 1200 and first["error"] == 200
    assert first["leadHours"] == pytest.approx(14.5)
    assert second["error"] == -500
    assert view["metrics"]["n"] == 2
    assert view["forecastPublishTime"] == "2026-01-14T09:30:00Z"
    assert len(view["actualsHalfHourly"]) == 48


def test_error_metrics():
    m = A.error_metrics([110, 90, 100], [100, 100, 100])
    assert m["mae"] == pytest.approx(20 / 3)
    assert m["bias"] == 0
    assert m["rmse"] == pytest.approx(math.sqrt(200 / 3))
    assert m["nmaePct"] == pytest.approx(20 / 3)
    assert A.error_metrics([], [])["n"] == 0


def test_percentile_interpolates():
    assert A.percentile([0, 10], 50) == 5
    assert A.percentile([1, 2, 3, 4, 5], 90) == pytest.approx(4.6)
    assert math.isnan(A.percentile([], 50))


def test_horizon_report_buckets_by_lead_time():
    rows = A.horizon_report(_ds(), date(2026, 1, 15), date(2026, 1, 15), bucket_hours=6)
    leads = {r["leadFromHours"]: r["n"] for r in rows}
    # Leads: 16.5h, 14.5h, 15.5h, 12.5h -> all in the 12-18h bucket.
    assert leads == {12: 4}


def _day_pairs(day: str, publish: str, forecast: float, actual: float):
    f = [_fc(publish, f"{day}T{h:02d}:00:00Z", forecast) for h in range(24)]
    a = [{"startTime": f"{day}T{h:02d}:00:00Z", "generation": actual} for h in range(24)]
    return f, a


def test_correction_uses_only_days_settled_before_decision():
    # D-2 (13 Jan): forecast twice the actual -> factor 0.5.
    f1, a1 = _day_pairs("2026-01-13", "2026-01-12T09:30:00Z", 2000, 1000)
    # D-1 (14 Jan) is not fully metered at gate closure and must be ignored.
    f2, a2 = _day_pairs("2026-01-14", "2026-01-13T09:30:00Z", 1000, 9000)
    ds = A.Dataset(a1 + a2, f1 + f2)
    corr = A.correction(ds, date(2026, 1, 15), 11)
    assert corr["factor"] == pytest.approx(0.5)
    assert corr["trainingTo"] == "2026-01-13"
    assert corr["trainingHours"] == 24


def test_day_ahead_view_applies_correction():
    f1, a1 = _day_pairs("2026-01-13", "2026-01-12T09:30:00Z", 2000, 1000)
    f3, a3 = _day_pairs("2026-01-15", "2026-01-14T09:30:00Z", 4000, 2000)
    view = A.day_ahead_view(A.Dataset(a1 + a3, f1 + f3), date(2026, 1, 15), 11)
    assert view["slots"][0]["corrected"] == pytest.approx(2000)
    assert view["correctedMetrics"]["mae"] == pytest.approx(0)
    assert view["metrics"]["mae"] == pytest.approx(2000)
