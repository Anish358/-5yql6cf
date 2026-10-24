"""Pure functions for day-ahead forecast selection and forecast-error statistics.

Sign convention: error = forecast - actual. A positive error means wind under-delivered
versus the forecast, i.e. the buyer would be short and need to procure more power.
"""

import math
from bisect import bisect_right
from collections import defaultdict
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta

from app.config import UK_TZ

HOUR = timedelta(hours=1)


def parse_ts(s: str) -> datetime:
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def fmt_ts(dt: datetime) -> str:
    return dt.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


@dataclass(frozen=True)
class Vintage:
    publish_time: datetime
    generation: float


class Dataset:
    """Indexes actuals by start time and forecasts by start time (vintages sorted by publish)."""

    def __init__(self, actuals: list[dict], forecasts: list[dict]):
        self.actuals: dict[datetime, float] = {
            parse_ts(r["startTime"]): float(r["generation"]) for r in actuals
        }
        by_start: dict[datetime, list[Vintage]] = defaultdict(list)
        for r in forecasts:
            by_start[parse_ts(r["startTime"])].append(
                Vintage(parse_ts(r["publishTime"]), float(r["generation"]))
            )
        self.forecasts: dict[datetime, list[Vintage]] = {
            k: sorted(v, key=lambda x: x.publish_time) for k, v in by_start.items()
        }
        self._publish_keys = {k: [x.publish_time for x in v] for k, v in self.forecasts.items()}

    def latest_forecast(self, start: datetime, as_of: datetime) -> Vintage | None:
        """Most recent forecast for `start` that was published at or before `as_of`."""
        keys = self._publish_keys.get(start)
        if not keys:
            return None
        i = bisect_right(keys, as_of)
        return self.forecasts[start][i - 1] if i else None

    def publish_times(self) -> list[datetime]:
        return sorted({v.publish_time for vs in self.forecasts.values() for v in vs})


def decision_cutoff(delivery_date: date, cutoff_hour: int) -> datetime:
    """Gate-closure instant on D-1 in UK local time, as an aware datetime."""
    return datetime.combine(delivery_date - timedelta(days=1), time(cutoff_hour), UK_TZ)


def delivery_hours(delivery_date: date) -> list[datetime]:
    """Hourly UTC start times covering the UK-local delivery day (handles 23/25h DST days)."""
    start = datetime.combine(delivery_date, time(), UK_TZ).astimezone(UTC)
    end = datetime.combine(delivery_date + timedelta(days=1), time(), UK_TZ).astimezone(UTC)
    out, t = [], start
    while t < end:
        out.append(t)
        t += HOUR
    return out


def delivery_half_hours(delivery_date: date) -> list[datetime]:
    hours = delivery_hours(delivery_date)
    return [t + timedelta(minutes=m) for t in hours for m in (0, 30)]


def percentile(values: list[float], q: float) -> float:
    """Linear-interpolated percentile, q in [0, 100]."""
    if not values:
        return math.nan
    s = sorted(values)
    pos = (len(s) - 1) * q / 100
    lo, hi = math.floor(pos), math.ceil(pos)
    return s[lo] + (s[hi] - s[lo]) * (pos - lo)


def error_metrics(forecasts: list[float], actuals: list[float]) -> dict:
    n = len(forecasts)
    if n == 0:
        return {"n": 0}
    errors = [f - a for f, a in zip(forecasts, actuals, strict=True)]
    abs_errors = [abs(e) for e in errors]
    mean_actual = sum(actuals) / n
    mae = sum(abs_errors) / n
    return {
        "n": n,
        "mae": mae,
        "rmse": math.sqrt(sum(e * e for e in errors) / n),
        "bias": sum(errors) / n,
        "nmaePct": 100 * mae / mean_actual if mean_actual else None,
        "p10": percentile(errors, 10),
        "p50": percentile(errors, 50),
        "p90": percentile(errors, 90),
        "maxAbsError": max(abs_errors),
        "overForecastPct": 100 * sum(e > 0 for e in errors) / n,
        "meanActual": mean_actual,
        "meanForecast": sum(forecasts) / n,
    }


def day_ahead_slots(ds: Dataset, delivery_date: date, cutoff_hour: int) -> list[dict]:
    """For each hour of the delivery day, the forecast a buyer would have seen at gate closure."""
    cutoff = decision_cutoff(delivery_date, cutoff_hour)
    slots = []
    for t in delivery_hours(delivery_date):
        v = ds.latest_forecast(t, cutoff)
        actual = ds.actuals.get(t)
        slots.append(
            {
                "startTime": fmt_ts(t),
                "forecast": v.generation if v else None,
                "publishTime": fmt_ts(v.publish_time) if v else None,
                "leadHours": (t - v.publish_time) / HOUR if v else None,
                "actual": actual,
                "error": v.generation - actual if v and actual is not None else None,
            }
        )
    return slots


def _paired(slots: list[dict]) -> tuple[list[float], list[float]]:
    pairs = [(s["forecast"], s["actual"]) for s in slots if s["error"] is not None]
    return [p[0] for p in pairs], [p[1] for p in pairs]


CORRECTION_WINDOW_DAYS = 14


def correction(ds: Dataset, delivery_date: date, cutoff_hour: int) -> dict:
    """Walk-forward scale factor: actual/forecast energy over the trailing settled days.

    Training days are D-2 back to D-(1+window): D-1 is still in progress at gate closure,
    so only days fully metered before the decision are used (no look-ahead).
    """
    days = [delivery_date - timedelta(days=k) for k in range(2, 2 + CORRECTION_WINDOW_DAYS)]
    f_sum = a_sum = 0.0
    n = 0
    for d in days:
        f, a = _paired(day_ahead_slots(ds, d, cutoff_hour))
        f_sum += sum(f)
        a_sum += sum(a)
        n += len(f)
    return {
        "factor": a_sum / f_sum if f_sum else 1.0,
        "trainingFrom": days[-1].isoformat(),
        "trainingTo": days[0].isoformat(),
        "trainingHours": n,
    }


def day_ahead_view(ds: Dataset, delivery_date: date, cutoff_hour: int) -> dict:
    slots = day_ahead_slots(ds, delivery_date, cutoff_hour)
    corr = correction(ds, delivery_date, cutoff_hour)
    for s in slots:
        s["corrected"] = s["forecast"] * corr["factor"] if s["forecast"] is not None else None
    f, a = _paired(slots)
    fc = [s["corrected"] for s in slots if s["error"] is not None]
    forecast_slots = [s for s in slots if s["forecast"] is not None]
    used_publishes = sorted({s["publishTime"] for s in forecast_slots})
    return {
        "deliveryDate": delivery_date.isoformat(),
        "decisionCutoff": fmt_ts(decision_cutoff(delivery_date, cutoff_hour)),
        "forecastPublishTime": used_publishes[-1] if used_publishes else None,
        "slots": slots,
        "actualsHalfHourly": [
            {"startTime": fmt_ts(t), "actual": ds.actuals.get(t)}
            for t in delivery_half_hours(delivery_date)
        ],
        "forecastEnergyMWh": sum(s["forecast"] for s in forecast_slots),
        "correctedEnergyMWh": sum(s["corrected"] for s in forecast_slots),
        "actualEnergyMWh": sum(a) if a else None,
        "metrics": error_metrics(f, a),
        "correction": corr,
        "correctedMetrics": error_metrics(fc, a),
    }


def accuracy_report(
    ds: Dataset, start: date, end: date, cutoff_hour: int, bin_mw: int = 1000
) -> dict:
    all_f, all_a, all_c, daily = [], [], [], []
    by_hour: dict[int, tuple[list[float], list[float]]] = defaultdict(lambda: ([], []))

    d = start
    while d <= end:
        slots = day_ahead_slots(ds, d, cutoff_hour)
        f, a = _paired(slots)
        factor = correction(ds, d, cutoff_hour)["factor"]
        c = [x * factor for x in f]
        all_f += f
        all_a += a
        all_c += c
        m = error_metrics(f, a)
        if m["n"]:
            mc = error_metrics(c, a)
            daily.append(
                {
                    "date": d.isoformat(),
                    "mae": m["mae"],
                    "bias": m["bias"],
                    "meanActual": m["meanActual"],
                    "meanForecast": m["meanForecast"],
                    "maxAbsError": m["maxAbsError"],
                    "correctedMae": mc["mae"],
                    "correctionFactor": factor,
                }
            )
        for s in slots:
            if s["error"] is not None:
                h = parse_ts(s["startTime"]).astimezone(UK_TZ).hour
                by_hour[h][0].append(s["forecast"])
                by_hour[h][1].append(s["actual"])
        d += timedelta(days=1)

    errors = [x - y for x, y in zip(all_f, all_a, strict=True)]
    hist: dict[int, int] = defaultdict(int)
    for e in errors:
        hist[math.floor(e / bin_mw) * bin_mw] += 1

    return {
        "cutoffHour": cutoff_hour,
        "deliveryStart": start.isoformat(),
        "deliveryEnd": end.isoformat(),
        "overall": error_metrics(all_f, all_a),
        "overallCorrected": error_metrics(all_c, all_a),
        "correctedShortfallBuffers": _buffers([x - y for x, y in zip(all_c, all_a, strict=True)]),
        "daily": daily,
        "byHourOfDay": [{"hour": h, **_summary(*by_hour[h])} for h in sorted(by_hour)],
        "histogram": [
            {"binStart": b, "binEnd": b + bin_mw, "count": hist[b]} for b in sorted(hist)
        ],
        "shortfallBuffers": _buffers(errors),
    }


def _buffers(errors: list[float]) -> list[dict]:
    """MW to hold back from the forecast so wind shortfalls are covered q% of the time."""
    return [
        {"coveragePct": q, "bufferMW": max(0.0, percentile(errors, q))} for q in (50, 80, 90, 95)
    ]


def _summary(f: list[float], a: list[float]) -> dict:
    m = error_metrics(f, a)
    return {"n": m["n"], "mae": m["mae"], "bias": m["bias"], "rmse": m["rmse"]}


def horizon_report(ds: Dataset, start: date, end: date, bucket_hours: int = 6) -> list[dict]:
    """Error of every forecast vintage, grouped by lead time (start - publish)."""
    window_start = datetime.combine(start, time(), UK_TZ)
    window_end = datetime.combine(end + timedelta(days=1), time(), UK_TZ)
    buckets: dict[int, tuple[list[float], list[float]]] = defaultdict(lambda: ([], []))
    for t, vintages in ds.forecasts.items():
        actual = ds.actuals.get(t)
        if actual is None or not (window_start <= t < window_end):
            continue
        for v in vintages:
            lead = (t - v.publish_time) / HOUR
            if lead < 0:
                continue
            b = int(lead // bucket_hours) * bucket_hours
            buckets[b][0].append(v.generation)
            buckets[b][1].append(actual)
    return [
        {"leadFromHours": b, "leadToHours": b + bucket_hours, **_summary(*buckets[b])}
        for b in sorted(buckets)
    ]


def vintages_for_day(ds: Dataset, delivery_date: date, cutoff_hour: int) -> dict:
    """Every forecast vintage covering the delivery day, to show how the outlook evolved."""
    hours = delivery_hours(delivery_date)
    cutoff = decision_cutoff(delivery_date, cutoff_hour)
    decision = ds.latest_forecast(hours[0], cutoff)
    by_publish: dict[datetime, list[dict]] = defaultdict(list)
    for t in hours:
        for v in ds.forecasts.get(t, []):
            by_publish[v.publish_time].append({"startTime": fmt_ts(t), "forecast": v.generation})
    return {
        "deliveryDate": delivery_date.isoformat(),
        "decisionPublishTime": fmt_ts(decision.publish_time) if decision else None,
        "vintages": [
            {
                "publishTime": fmt_ts(p),
                "afterCutoff": p > cutoff,
                "points": pts,
            }
            for p, pts in sorted(by_publish.items())
        ],
    }
