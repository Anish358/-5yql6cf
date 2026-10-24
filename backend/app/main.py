import os
from datetime import date
from functools import lru_cache
from typing import Literal

from fastapi import APIRouter, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from pydantic import BaseModel, Field

from app import ai, analysis
from app.config import DEFAULT_CUTOFF_HOUR, DELIVERY_END, DELIVERY_START
from app.store import get_dataset, load_snapshot

app = FastAPI(
    title="UK Wind Day-Ahead API",
    description="Day-ahead wind forecasts and forecast-accuracy analytics (Elexon BMRS).",
    version="0.1.0",
)
app.add_middleware(GZipMiddleware, minimum_size=1000)
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("CORS_ORIGINS", "*").split(","),
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

api = APIRouter(prefix="/api")

CutoffHour = Query(DEFAULT_CUTOFF_HOUR, ge=0, le=23, description="Gate-closure hour on D-1 (UK)")


def _check_delivery_date(d: date) -> date:
    if not DELIVERY_START <= d <= DELIVERY_END:
        raise HTTPException(
            404, f"delivery_date must be between {DELIVERY_START} and {DELIVERY_END}"
        )
    return d


@api.get("/health")
def health() -> dict:
    return {"status": "ok"}


@api.get("/meta")
def meta() -> dict:
    snap = load_snapshot()
    return {
        "deliveryStart": DELIVERY_START.isoformat(),
        "deliveryEnd": DELIVERY_END.isoformat(),
        "defaultCutoffHour": DEFAULT_CUTOFF_HOUR,
        "dataFetchedAt": snap["fetchedAt"],
        "source": snap["source"],
        "forecastPublishTimes": [analysis.fmt_ts(t) for t in get_dataset().publish_times()],
    }


@api.get("/day-ahead")
def day_ahead(delivery_date: date, cutoff_hour: int = CutoffHour) -> dict:
    return analysis.day_ahead_view(get_dataset(), _check_delivery_date(delivery_date), cutoff_hour)


@lru_cache(maxsize=24)
def _accuracy(cutoff_hour: int) -> dict:
    return analysis.accuracy_report(get_dataset(), DELIVERY_START, DELIVERY_END, cutoff_hour)


@api.get("/accuracy")
def accuracy(cutoff_hour: int = CutoffHour) -> dict:
    return _accuracy(cutoff_hour)


@lru_cache(maxsize=8)
def _horizon(bucket_hours: int) -> list[dict]:
    return analysis.horizon_report(get_dataset(), DELIVERY_START, DELIVERY_END, bucket_hours)


@api.get("/horizon")
def horizon(bucket_hours: int = Query(6, ge=1, le=24)) -> list[dict]:
    return _horizon(bucket_hours)


@api.get("/vintages")
def vintages(delivery_date: date, cutoff_hour: int = CutoffHour) -> dict:
    return analysis.vintages_for_day(
        get_dataset(), _check_delivery_date(delivery_date), cutoff_hour
    )


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=4000)


class ChatRequest(BaseModel):
    messages: list[ChatMessage] = Field(min_length=1, max_length=20)
    delivery_date: date | None = None
    cutoff_hour: int | None = Field(None, ge=0, le=23)


class BriefRequest(BaseModel):
    delivery_date: date
    cutoff_hour: int = Field(DEFAULT_CUTOFF_HOUR, ge=0, le=23)


def _ai_call(fn, *args) -> dict:
    try:
        return fn(*args)
    except ai.AIUnavailable as e:
        raise HTTPException(503, str(e)) from e
    except ai.AIError as e:
        raise HTTPException(502, str(e)) from e


@api.post("/ai/chat")
def ai_chat(req: ChatRequest) -> dict:
    return _ai_call(
        ai.chat,
        [m.model_dump() for m in req.messages],
        req.delivery_date.isoformat() if req.delivery_date else None,
        req.cutoff_hour,
    )


@api.post("/ai/brief")
def ai_brief(req: BriefRequest) -> dict:
    _check_delivery_date(req.delivery_date)
    return _ai_call(ai.brief, req.delivery_date.isoformat(), req.cutoff_hour)


app.include_router(api)
