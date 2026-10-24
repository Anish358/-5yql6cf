import json
import urllib.parse
import urllib.request
from datetime import date, datetime, timedelta

from app.config import ELEXON_BASE_URL

TIMEOUT_S = 60


def _get(path: str, params: dict[str, str]) -> list[dict]:
    url = f"{ELEXON_BASE_URL}{path}?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=TIMEOUT_S) as resp:
        return json.load(resp)


def fetch_wind_actuals(settlement_from: date, settlement_to: date) -> list[dict]:
    """Half-hourly outturn generation for fuelType=WIND (FUELHH)."""
    rows = _get(
        "/datasets/FUELHH/stream",
        {
            "settlementDateFrom": settlement_from.isoformat(),
            "settlementDateTo": settlement_to.isoformat(),
            "fuelType": "WIND",
        },
    )
    return [
        {
            "startTime": r["startTime"],
            "publishTime": r["publishTime"],
            "generation": r["generation"],
        }
        for r in rows
        if r.get("fuelType") == "WIND"
    ]


def fetch_wind_forecasts(
    publish_from: datetime, publish_to: datetime, chunk: timedelta = timedelta(days=4)
) -> list[dict]:
    """Every WINDFOR vintage published in the window, fetched in chunks to keep responses small."""
    out: list[dict] = []
    cursor = publish_from
    while cursor < publish_to:
        end = min(cursor + chunk, publish_to)
        rows = _get(
            "/datasets/WINDFOR/stream",
            {
                "publishDateTimeFrom": cursor.strftime("%Y-%m-%dT%H:%M:%SZ"),
                "publishDateTimeTo": end.strftime("%Y-%m-%dT%H:%M:%SZ"),
            },
        )
        out.extend(
            {
                "startTime": r["startTime"],
                "publishTime": r["publishTime"],
                "generation": r["generation"],
            }
            for r in rows
        )
        cursor = end
    return out
