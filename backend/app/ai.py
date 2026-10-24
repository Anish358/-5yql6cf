"""AI analyst: Gemini with function calling over the same analysis functions the UI uses.

Every number the model states comes from a tool call, so answers are grounded in the data.
"""

import json
import os
import urllib.error
import urllib.request
from datetime import date

from app import analysis
from app.config import DEFAULT_CUTOFF_HOUR, DELIVERY_END, DELIVERY_START
from app.store import get_dataset

GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
MAX_TOOL_ROUNDS = 6
DEFAULT_MODEL = "gemini-3.5-flash"
TIMEOUT_S = 45


class AIUnavailable(Exception):
    pass


class AIError(Exception):
    pass


SYSTEM_PROMPT = f"""You are the AI analyst inside "Wind Day-Ahead Desk", a tool for the day-ahead \
power purchasing team of a GB electricity utility. They buy power one day ahead (gate closure \
11:00 UK on D-1) to cover demand not met by wind, so they rely on wind forecasts.

Data you can query via tools (national GB wind only, Elexon BMRS):
- Actual wind generation (FUELHH, half-hourly) and wind forecasts (WINDFOR, hourly, ~8 runs/day).
- Scope: delivery days {DELIVERY_START} to {DELIVERY_END} (purchase decisions made in January 2026).

Definitions:
- "Day-ahead forecast" = latest forecast run published at or before the decision time on D-1.
- error = forecast - actual. Positive = wind under-delivered = desk short (must buy more).
- "Corrected forecast" = Elexon forecast x a scale factor (actual/forecast energy over the 14 days \
fully metered before the decision, D-2 back to D-15). Uses no future data.
- Shortfall buffer Pq = q-th percentile of errors: hold back this much wind to be covered \
q% of hours.

Rules:
- ALWAYS get numbers from tools. Never estimate or invent figures. If a tool can't answer, say so.
- Be concise and practical, like a senior analyst briefing a trader. Lead with the answer.
- Units: GW with 2 decimals for power, GWh for energy, UK local time for hours.
- Use short markdown: bold key numbers, bullet lists, small tables only when they help.
- Questions outside this data (prices, demand, other fuels, other months) - say it is outside the \
pilot's data scope, then answer what you can from the data.
"""


def _r(x: float | None, nd: int = 0):
    return None if x is None else round(x, nd) if nd else round(x)


def _metrics_brief(m: dict) -> dict:
    if not m.get("n"):
        return {"n": 0}
    return {
        "hours": m["n"],
        "maeMW": _r(m["mae"]),
        "rmseMW": _r(m["rmse"]),
        "biasMW": _r(m["bias"]),
        "nmaePct": _r(m["nmaePct"], 1),
        "p10MW": _r(m["p10"]),
        "p50MW": _r(m["p50"]),
        "p90MW": _r(m["p90"]),
        "maxAbsErrorMW": _r(m["maxAbsError"]),
        "overForecastHoursPct": _r(m["overForecastPct"], 1),
    }


def _parse_date(s: str) -> date:
    d = date.fromisoformat(s)
    if not DELIVERY_START <= d <= DELIVERY_END:
        raise ValueError(f"delivery_date must be between {DELIVERY_START} and {DELIVERY_END}")
    return d


def tool_get_day_ahead(delivery_date: str, cutoff_hour: int = DEFAULT_CUTOFF_HOUR) -> dict:
    v = analysis.day_ahead_view(get_dataset(), _parse_date(delivery_date), int(cutoff_hour))
    return {
        "deliveryDate": v["deliveryDate"],
        "decisionCutoffUTC": v["decisionCutoff"],
        "forecastRunUsedUTC": v["forecastPublishTime"],
        "forecastEnergyGWh": _r(v["forecastEnergyMWh"] / 1000, 1),
        "correctedEnergyGWh": _r(v["correctedEnergyMWh"] / 1000, 1),
        "actualEnergyGWh": _r((v["actualEnergyMWh"] or 0) / 1000, 1),
        "correctionFactor": _r(v["correction"]["factor"], 3),
        "elexonForecastErrors": _metrics_brief(v["metrics"]),
        "correctedForecastErrors": _metrics_brief(v["correctedMetrics"]),
        "hourly": [
            {
                "hourUK": analysis.parse_ts(s["startTime"]).astimezone(analysis.UK_TZ).hour,
                "forecastMW": _r(s["forecast"]),
                "correctedMW": _r(s["corrected"]),
                "actualMW": _r(s["actual"]),
                "errorMW": _r(s["error"]),
            }
            for s in v["slots"]
        ],
    }


def _accuracy(cutoff_hour: int) -> dict:
    return analysis.accuracy_report(get_dataset(), DELIVERY_START, DELIVERY_END, cutoff_hour)


def tool_get_accuracy_summary(cutoff_hour: int = DEFAULT_CUTOFF_HOUR) -> dict:
    a = _accuracy(int(cutoff_hour))
    by_mae = sorted(a["daily"], key=lambda d: d["mae"])
    by_bias = sorted(a["daily"], key=lambda d: d["bias"])

    def day(d: dict) -> dict:
        return {"date": d["date"], "maeMW": _r(d["mae"]), "biasMW": _r(d["bias"])}

    return {
        "cutoffHourUK": a["cutoffHour"],
        "deliveryDays": f"{a['deliveryStart']} to {a['deliveryEnd']}",
        "elexonForecast": _metrics_brief(a["overall"]),
        "correctedForecast": _metrics_brief(a["overallCorrected"]),
        "shortfallBuffersElexonMW": {
            f"P{b['coveragePct']}": _r(b["bufferMW"]) for b in a["shortfallBuffers"]
        },
        "shortfallBuffersCorrectedMW": {
            f"P{b['coveragePct']}": _r(b["bufferMW"]) for b in a["correctedShortfallBuffers"]
        },
        "worstDaysByMAE": [day(d) for d in by_mae[-5:][::-1]],
        "bestDaysByMAE": [day(d) for d in by_mae[:5]],
        "mostOverForecastDays": [day(d) for d in by_bias[-3:][::-1]],
        "mostUnderForecastDays": [day(d) for d in by_bias[:3]],
        "maeByHourOfDayUK": {h["hour"]: _r(h["mae"]) for h in a["byHourOfDay"]},
    }


def tool_get_daily_table(cutoff_hour: int = DEFAULT_CUTOFF_HOUR) -> dict:
    a = _accuracy(int(cutoff_hour))
    return {
        "days": [
            {
                "date": d["date"],
                "meanActualMW": _r(d["meanActual"]),
                "meanForecastMW": _r(d["meanForecast"]),
                "maeMW": _r(d["mae"]),
                "biasMW": _r(d["bias"]),
                "correctedMaeMW": _r(d["correctedMae"]),
                "maxAbsErrorMW": _r(d["maxAbsError"]),
            }
            for d in a["daily"]
        ]
    }


def tool_get_lead_time_errors() -> dict:
    rows = analysis.horizon_report(get_dataset(), DELIVERY_START, DELIVERY_END, 6)
    return {
        "note": "All forecast runs, grouped by hours between publish and delivery",
        "buckets": [
            {
                "leadHours": f"{b['leadFromHours']}-{b['leadToHours']}",
                "maeMW": _r(b["mae"]),
                "biasMW": _r(b["bias"]),
                "samples": b["n"],
            }
            for b in rows
        ],
    }


def tool_get_forecast_runs(delivery_date: str, cutoff_hour: int = DEFAULT_CUTOFF_HOUR) -> dict:
    v = analysis.vintages_for_day(get_dataset(), _parse_date(delivery_date), int(cutoff_hour))
    return {
        "deliveryDate": v["deliveryDate"],
        "runUsedForDecisionUTC": v["decisionPublishTime"],
        "runs": [
            {
                "publishTimeUTC": r["publishTime"],
                "afterGateClosure": r["afterCutoff"],
                "hoursCovered": len(r["points"]),
                "meanForecastMW": _r(sum(p["forecast"] for p in r["points"]) / len(r["points"])),
            }
            for r in v["vintages"]
        ],
    }


_DATE = {"type": "string", "description": "Delivery day, YYYY-MM-DD"}
_CUTOFF = {
    "type": "integer",
    "description": f"Decision hour (UK) on D-1, default {DEFAULT_CUTOFF_HOUR}",
}

TOOLS = {
    "get_day_ahead": (
        tool_get_day_ahead,
        "Forecast available at decision time vs actual for one delivery day: hourly values, "
        "energy totals, error metrics for Elexon and corrected forecasts.",
        {"delivery_date": _DATE, "cutoff_hour": _CUTOFF},
        ["delivery_date"],
    ),
    "get_accuracy_summary": (
        tool_get_accuracy_summary,
        "Accuracy over all delivery days: overall metrics (Elexon and corrected), shortfall "
        "buffers, best/worst days, most over/under-forecast days, MAE by hour of day.",
        {"cutoff_hour": _CUTOFF},
        [],
    ),
    "get_daily_table": (
        tool_get_daily_table,
        "One row per delivery day: mean actual, mean forecast, MAE, bias, corrected MAE.",
        {"cutoff_hour": _CUTOFF},
        [],
    ),
    "get_lead_time_errors": (
        tool_get_lead_time_errors,
        "How forecast error changes with lead time (hours ahead), across all forecast runs.",
        {},
        [],
    ),
    "get_forecast_runs": (
        tool_get_forecast_runs,
        "Every forecast run covering a delivery day, flagged before/after gate closure, "
        "to see how the outlook changed.",
        {"delivery_date": _DATE, "cutoff_hour": _CUTOFF},
        ["delivery_date"],
    ),
}


def _declarations() -> list[dict]:
    out = []
    for name, (_, desc, props, required) in TOOLS.items():
        decl: dict = {"name": name, "description": desc}
        if props:
            decl["parameters"] = {"type": "object", "properties": props, "required": required}
        out.append(decl)
    return out


def _call_gemini(contents: list[dict], system: str) -> dict:
    key = os.getenv("GEMINI_API_KEY")
    if not key:
        raise AIUnavailable("AI analyst is not configured: set GEMINI_API_KEY on the server.")
    model = os.getenv("GEMINI_MODEL") or DEFAULT_MODEL
    body = {
        "systemInstruction": {"parts": [{"text": system}]},
        "contents": contents,
        "tools": [{"functionDeclarations": _declarations()}],
        "generationConfig": {"temperature": 0.2, "thinkingConfig": {"thinkingLevel": "low"}},
    }
    req = urllib.request.Request(
        GEMINI_URL.format(model=model),
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json", "x-goog-api-key": key},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT_S) as resp:
            return json.load(resp)
    except urllib.error.HTTPError as e:
        if e.code == 429:
            raise AIError(
                "The AI service has reached its usage limit for now. Please try again later; "
                "every number it would use is also in the charts and tables."
            ) from e
        detail = e.read().decode(errors="replace")[:300]
        raise AIError(f"Gemini API error {e.code}: {detail}") from e
    except urllib.error.URLError as e:
        raise AIError(f"Could not reach Gemini API: {e.reason}") from e
    except TimeoutError as e:
        raise AIError("Gemini took too long to respond; please try again.") from e


def _run_tool(name: str, args: dict) -> dict:
    if name not in TOOLS:
        return {"error": f"Unknown tool {name}"}
    try:
        return TOOLS[name][0](**args)
    except (TypeError, ValueError) as e:
        return {"error": str(e)}


def chat(messages: list[dict], delivery_date: str | None, cutoff_hour: int | None) -> dict:
    system = SYSTEM_PROMPT
    if delivery_date:
        system += (
            f"\nThe user is currently viewing delivery day {delivery_date} with decision hour "
            f"{cutoff_hour if cutoff_hour is not None else DEFAULT_CUTOFF_HOUR}:00 UK. "
            "'Tomorrow', 'this day' or 'today' refer to that delivery day."
        )
    contents = [
        {"role": "model" if m["role"] == "assistant" else "user", "parts": [{"text": m["content"]}]}
        for m in messages
    ]
    trace: list[dict] = []

    for _ in range(MAX_TOOL_ROUNDS):
        resp = _call_gemini(contents, system)
        candidates = resp.get("candidates") or []
        if not candidates or "content" not in candidates[0]:
            reason = (candidates[0].get("finishReason") if candidates else None) or "no response"
            raise AIError(f"Gemini returned no answer ({reason}).")
        content = candidates[0]["content"]
        parts = content.get("parts", [])
        calls = [p["functionCall"] for p in parts if "functionCall" in p]
        if not calls:
            text = "".join(p.get("text", "") for p in parts if not p.get("thought")).strip()
            return {"reply": text or "I couldn't produce an answer.", "toolCalls": trace}

        contents.append(content)
        responses = []
        for c in calls:
            args = c.get("args") or {}
            trace.append({"name": c["name"], "args": args})
            responses.append(
                {"functionResponse": {"name": c["name"], "response": _run_tool(c["name"], args)}}
            )
        contents.append({"role": "user", "parts": responses})

    raise AIError("The analyst needed too many steps; try a more specific question.")


BRIEF_PROMPT = """Write the morning brief for delivery day {date} for the day-ahead trader.
Use the tools (day-ahead data for that day, plus the accuracy summary for buffers).
Format exactly:
**Headline** - one sentence.
**Wind outlook** - Elexon vs corrected forecast energy, average and lowest/highest hours.
**Risk hours** - the 2-3 hours with the least wind or biggest expected shortfall risk.
**Recommendation** - wind to rely on at P90 cover (corrected forecast minus the corrected P90 \
buffer x hours), and the extra energy to buy versus taking the raw forecast at face value.
**Confidence** - one line based on recent forecast accuracy.
Keep it under 170 words. Do not mention what actually happened on the day."""


def brief(delivery_date: str, cutoff_hour: int) -> dict:
    _parse_date(delivery_date)
    prompt = BRIEF_PROMPT.format(date=delivery_date)
    return chat([{"role": "user", "content": prompt}], delivery_date, cutoff_hour)
