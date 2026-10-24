from datetime import date
from pathlib import Path
from zoneinfo import ZoneInfo

ELEXON_BASE_URL = "https://data.elexon.co.uk/bmrs/api/v1"

UK_TZ = ZoneInfo("Europe/London")

# Purchase decisions made during January 2026 are for delivery on the following day.
DELIVERY_START = date(2026, 1, 2)
DELIVERY_END = date(2026, 2, 1)

# GB day-ahead auction gate closure is 11:00 UK time on D-1.
DEFAULT_CUTOFF_HOUR = 11

SNAPSHOT_PATH = Path(__file__).resolve().parent.parent / "data" / "snapshot.json"
