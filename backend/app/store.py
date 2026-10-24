import json
from functools import lru_cache

from app.analysis import Dataset
from app.config import SNAPSHOT_PATH


@lru_cache(maxsize=1)
def load_snapshot() -> dict:
    return json.loads(SNAPSHOT_PATH.read_text())


@lru_cache(maxsize=1)
def get_dataset() -> Dataset:
    snap = load_snapshot()
    return Dataset(snap["actuals"], snap["forecasts"])
