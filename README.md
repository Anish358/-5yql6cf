# Wind Day-Ahead Desk

A web app for a GB utility's day-ahead purchasing team. It shows **the national wind forecast that was actually available when the buy decision had to be made**, and **how accurate that forecast has been**, so the team can size how much extra power to procure.

**Live app:** https://5yql6cf.vercel.app

Data: Elexon BMRS, national wind only — actual generation from [`FUELHH`](https://bmrs.elexon.co.uk/api-documentation/endpoint/datasets/FUELHH/stream) (`fuelType = WIND`) and forecasts from [`WINDFOR`](https://bmrs.elexon.co.uk/api-documentation/endpoint/datasets/WINDFOR/stream). Scope: purchase decisions made in January 2026.

---

## What the app does

**1. Day-ahead decision.** Pick a delivery day and a decision time (default 11:00 on D-1, GB day-ahead auction gate closure):

- The latest forecast run published before that decision time, with its publish time and lead time
- Elexon forecast vs **corrected forecast** vs actual, with an **expected range** band (P10–P90 of errors)
- A **planning wind** figure: corrected forecast minus the P90 buffer, and the shortfall to buy
- **AI morning brief**: a trader-ready summary of the day, generated from the data available at decision time
- **How the forecast evolved**: every forecast run covering that day, decision run highlighted, late runs dashed
- In-hindsight accuracy for that day, an hourly table, and **CSV export**

**2. Procurement plan.** Enter average demand (flat or an illustrative winter profile), your share of national wind and a risk appetite (P50–P95). The app shows **how much power to buy each hour** = demand − (corrected wind forecast − buffer), then checks the plan in hindsight: hours short, energy short, energy over-bought, compared with taking the raw forecast at face value.

**3. Forecast accuracy.** Across all January decisions:

- MAE, RMSE, bias, nMAE, P10/P50/P90 error, worst hour; Elexon vs corrected
- **Calendar heatmap** of daily error; click a day to open it in the decision view
- **Shortfall buffers**: how many GW to hold back to be covered in 50/80/90/95% of hours
- Corrected vs Elexon MAE by day, daily forecast vs actual, daily bias, error by hour of day, error distribution
- **Error vs forecast lead time** (every forecast run, 0–72 h ahead)

**4. AI analyst.** Ask questions in plain English ("Which days would have left us shortest, and why?"). The model (Google Gemini) answers by calling the **same analysis functions the charts use**, with each lookup shown as a chip, so figures come from the data rather than being made up.

### Key findings (January 2026, 11:00 D-1 decision)

| Metric | Value |
|---|---|
| Mean absolute error | 2.00 GW (17.7% of mean wind output) |
| Bias (forecast − actual) | **+1.73 GW**: forecast was above actual in 84% of hours |
| P90 over-forecast | 4.18 GW |
| MAE by lead time | 1.65 GW at 0–6 h → 2.37 GW at 66–72 h |
| **Corrected forecast MAE** | **1.29 GW (−35%)**, bias +0.40 GW |
| P90 buffer: Elexon → corrected | 4.18 GW → **2.85 GW** (≈32 GWh/day less insurance buying) |

The forecast is consistently optimistic. A buyer taking it at face value would usually have been short. A simple walk-forward correction removes most of that bias.

---

## Methodology

| Decision | Choice | Why |
|---|---|---|
| Delivery days | 2 Jan – 1 Feb 2026 | Decisions made in January are for delivery the following day |
| Decision time | 11:00 UK on D-1 (configurable 06:00–18:00) | GB day-ahead auction gate closure |
| Forecast used | Latest `WINDFOR` run with `publishTime ≤ decision time` | Avoids look-ahead: runs published later were not available to trade on |
| Comparison grain | Hourly (`WINDFOR` is hourly, `FUELHH` half-hourly); forecast at hour *t* vs actual for the period starting at *t* | No interpolation of the forecast |
| Error sign | `error = forecast − actual` | Positive = wind under-delivered = buyer short |
| Metrics | MAE, RMSE, bias, nMAE, empirical percentiles | MAPE avoided: it blows up when wind output is near zero |
| Time zones | Stored in UTC, delivery days and cutoffs computed in `Europe/London` | Correct across BST changes (23/25-hour days are unit-tested) |
| Revisions | Last-published value kept per key | Elexon can republish corrected values |
| Corrected forecast | Forecast × (actual ÷ forecast energy) over the 14 days fully metered before the decision (D-2 … D-15) | Walk-forward: no future data. Chosen over additive bias and linear fits after backtesting (ratio: 1.29 GW MAE; linear: 1.24 GW, but more parameters for little gain; additive: 1.49 GW) |
| Shortfall buffers | Empirical percentiles of January errors | Simple and transparent. In-sample over January, so slightly optimistic for out-of-sample use |

---

## Repository structure

```
.
├── backend/                 Python API (FastAPI)
│   ├── app/
│   │   ├── config.py        Scope (delivery dates, default gate closure), paths
│   │   ├── elexon.py        Elexon BMRS client (FUELHH, WINDFOR), chunked fetching
│   │   ├── analysis.py      Pure functions: day-ahead forecast selection, walk-forward
│   │   │                    correction, error metrics, accuracy report, lead-time analysis
│   │   ├── ai.py            AI analyst: Gemini function calling over analysis.py tools
│   │   ├── store.py         Loads and indexes the data snapshot once per process
│   │   └── main.py          FastAPI routes under /api
│   ├── scripts/fetch_data.py  Refreshes data/snapshot.json from Elexon
│   ├── data/snapshot.json   Cached January 2026 data (actuals + all forecast runs)
│   ├── tests/               pytest: analysis logic, API endpoints, AI tool loop (mocked)
│   ├── .env.example         GEMINI_API_KEY (optional, enables AI features)
│   ├── pyproject.toml / uv.lock
│   └── Dockerfile
├── frontend/                React + TypeScript (Vite), Recharts
│   ├── src/
│   │   ├── App.tsx          Layout, tabs, delivery-day and decision-time controls
│   │   ├── api.ts           Typed API client
│   │   ├── components/
│   │   │   ├── DecisionView.tsx     Day-ahead decision tab (+ AI brief, CSV export)
│   │   │   ├── ProcurementView.tsx  Procurement plan tab
│   │   │   ├── AccuracyView.tsx     Forecast accuracy tab (+ calendar heatmap)
│   │   │   ├── AnalystView.tsx      AI analyst chat
│   │   │   └── ui.tsx             Cards, stat tiles, legend, tooltip
│   │   ├── format.ts        Number/date formatting (UK time)
│   │   └── useAsync.ts      Data-fetching hook
│   ├── nginx.conf           Serves the build, proxies /api to the backend (Docker)
│   └── Dockerfile
├── api/index.py             Vercel serverless entrypoint wrapping the FastAPI app
├── vercel.json              Vercel build + routing config
├── requirements.txt         Python dependencies for the Vercel function
└── docker-compose.yml       Runs backend + frontend locally
```

### Design notes

- **Snapshot, not live calls.** January 2026 is historical and immutable, so the data is fetched once (`scripts/fetch_data.py`) and committed. The app starts fast, can't be broken by an Elexon outage, and every number is reproducible. Pointing it at live data means scheduling the same fetch script.
- **Pure analysis core.** `analysis.py` has no I/O, which keeps the domain logic (cutoff selection, DST handling, metrics) unit-testable in isolation.
- **No pandas.** About 20k rows don't need it. Plain Python keeps the Docker image and the serverless function small with fast cold starts.
- **Indexed lookups.** Forecast runs are indexed by target time and sorted by publish time, so "latest forecast before the cutoff" is a binary search.
- **Grounded AI.** The AI analyst gets no raw data in its prompt. It has five tools that wrap `analysis.py`, so every figure it quotes was computed by the same code as the charts. Tool calls are returned to the UI and shown as chips. It uses Gemini's REST API directly (no SDK), so there are no extra dependencies.
- **AI is optional.** Without `GEMINI_API_KEY` everything else works; the AI endpoints return `503` with a clear message.

---

## Running the application

### With Docker (recommended)

```bash
docker compose up --build
```

- App: http://localhost:8080
- API: http://localhost:8000/api/health · interactive docs at http://localhost:8000/docs

### AI features (optional)

Copy `backend/.env.example` to `backend/.env` and set `GEMINI_API_KEY` (free key from Google AI Studio). Docker Compose and the dev command below both read it.

### Local development

Backend (Python 3.12, [uv](https://docs.astral.sh/uv/)):

```bash
cd backend
uv sync
uv run uvicorn app.main:app --reload --port 8000 --env-file .env
```

Frontend (Node 20+), in a second terminal:

```bash
cd frontend
npm install
npm run dev            # proxies /api to http://localhost:8000
```

### Tests and linting

```bash
cd backend && uv run pytest && uv run ruff check .
cd frontend && npm run lint && npm run build
```

### Refreshing the data

```bash
cd backend && uv run python -m scripts.fetch_data
```

The Elexon API is public and needs no API key.

---

## API

| Endpoint | Description |
|---|---|
| `GET /api/meta` | Delivery date range, default decision time, data snapshot info, forecast publish times |
| `GET /api/day-ahead?delivery_date=2026-01-15&cutoff_hour=11` | Hourly forecast-at-decision vs actual, half-hourly actuals, day metrics |
| `GET /api/vintages?delivery_date=2026-01-15&cutoff_hour=11` | Every forecast run covering the day, flagged before/after the decision time |
| `GET /api/accuracy?cutoff_hour=11` | January-wide metrics, daily series, by hour of day, histogram, shortfall buffers |
| `GET /api/horizon?bucket_hours=6` | Error of all forecast runs grouped by lead time |
| `POST /api/ai/chat` | AI analyst. Body: `{messages: [{role, content}], delivery_date?, cutoff_hour?}` → `{reply, toolCalls}` |
| `POST /api/ai/brief` | AI morning brief. Body: `{delivery_date, cutoff_hour?}` → `{reply, toolCalls}` |
| `GET /api/health` | Health check |

---

## Deployment

Deployed on **Vercel** as a single project: the React build is served as static files and the FastAPI app runs as a Python serverless function (`api/index.py`) under `/api/*`. See `vercel.json`. `GEMINI_API_KEY` is set as a Vercel environment variable.

---

## Use of AI tools

- **Development:** built with the help of **Claude Code** (Anthropic), which assisted with scaffolding, implementation, tests and documentation. Design decisions, domain interpretation and the final review were mine.
- **In the product:** the AI analyst and morning brief use **Google Gemini** via its API, grounded on the app's own analysis functions.
