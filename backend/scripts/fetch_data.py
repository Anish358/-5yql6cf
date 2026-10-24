"""Refresh data/snapshot.json from Elexon. Run from backend/: `python -m scripts.fetch_data`."""

import json
from datetime import UTC, datetime, time, timedelta

from app.config import DELIVERY_END, DELIVERY_START, SNAPSHOT_PATH
from app.elexon import fetch_wind_actuals, fetch_wind_forecasts

# Extra history before the first delivery day so the walk-forward correction has training data.
TRAINING_LOOKBACK = timedelta(days=16)


def _dedupe(rows: list[dict], key: tuple[str, ...]) -> list[dict]:
    """Keep the last-published row per key (Elexon can republish corrected values)."""
    best: dict[tuple, dict] = {}
    for r in rows:
        k = tuple(r[f] for f in key)
        if k not in best or r["publishTime"] > best[k]["publishTime"]:
            best[k] = r
    return sorted(best.values(), key=lambda r: (r["startTime"], r["publishTime"]))


def main() -> None:
    day = timedelta(days=1)
    actuals = fetch_wind_actuals(DELIVERY_START - TRAINING_LOOKBACK, DELIVERY_END + day)
    publish_from = datetime.combine(DELIVERY_START, time(), UTC) - TRAINING_LOOKBACK - 3 * day
    publish_to = datetime.combine(DELIVERY_END + timedelta(days=1), time(), UTC)
    forecasts = fetch_wind_forecasts(publish_from, publish_to)

    snapshot = {
        "fetchedAt": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": "Elexon BMRS Insights API (FUELHH fuelType=WIND, WINDFOR)",
        "actuals": _dedupe(actuals, ("startTime",)),
        "forecasts": _dedupe(forecasts, ("startTime", "publishTime")),
    }
    SNAPSHOT_PATH.parent.mkdir(parents=True, exist_ok=True)
    SNAPSHOT_PATH.write_text(json.dumps(snapshot, separators=(",", ":")))
    print(
        f"Wrote {len(snapshot['actuals'])} actuals and {len(snapshot['forecasts'])} forecasts "
        f"to {SNAPSHOT_PATH}"
    )


if __name__ == "__main__":
    main()
