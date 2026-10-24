const BASE = import.meta.env.VITE_API_BASE ?? ''

export interface Metrics {
  n: number
  mae: number
  rmse: number
  bias: number
  nmaePct: number | null
  p10: number
  p50: number
  p90: number
  maxAbsError: number
  overForecastPct: number
  meanActual: number
  meanForecast: number
}

export interface Meta {
  deliveryStart: string
  deliveryEnd: string
  defaultCutoffHour: number
  dataFetchedAt: string
  source: string
  forecastPublishTimes: string[]
}

export interface Slot {
  startTime: string
  forecast: number | null
  publishTime: string | null
  leadHours: number | null
  actual: number | null
  error: number | null
}

export interface DayAhead {
  deliveryDate: string
  decisionCutoff: string
  forecastPublishTime: string | null
  slots: Slot[]
  actualsHalfHourly: { startTime: string; actual: number | null }[]
  forecastEnergyMWh: number
  actualEnergyMWh: number | null
  metrics: Metrics
}

export interface Accuracy {
  cutoffHour: number
  deliveryStart: string
  deliveryEnd: string
  overall: Metrics
  daily: {
    date: string
    mae: number
    bias: number
    meanActual: number
    meanForecast: number
    maxAbsError: number
  }[]
  byHourOfDay: { hour: number; n: number; mae: number; bias: number; rmse: number }[]
  histogram: { binStart: number; binEnd: number; count: number }[]
  shortfallBuffers: { coveragePct: number; bufferMW: number }[]
}

export interface HorizonBucket {
  leadFromHours: number
  leadToHours: number
  n: number
  mae: number
  bias: number
  rmse: number
}

export interface Vintages {
  deliveryDate: string
  decisionPublishTime: string | null
  vintages: {
    publishTime: string
    afterCutoff: boolean
    points: { startTime: string; forecast: number }[]
  }[]
}

async function get<T>(path: string, params: Record<string, string | number> = {}): Promise<T> {
  const qs = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]))
  const url = `${BASE}/api${path}${qs.size ? `?${qs}` : ''}`
  const res = await fetch(url)
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new Error(body?.detail ?? `${res.status} ${res.statusText}`)
  }
  return res.json() as Promise<T>
}

export const api = {
  meta: () => get<Meta>('/meta'),
  dayAhead: (deliveryDate: string, cutoffHour: number) =>
    get<DayAhead>('/day-ahead', { delivery_date: deliveryDate, cutoff_hour: cutoffHour }),
  vintages: (deliveryDate: string, cutoffHour: number) =>
    get<Vintages>('/vintages', { delivery_date: deliveryDate, cutoff_hour: cutoffHour }),
  accuracy: (cutoffHour: number) => get<Accuracy>('/accuracy', { cutoff_hour: cutoffHour }),
  horizon: (bucketHours = 6) => get<HorizonBucket[]>('/horizon', { bucket_hours: bucketHours }),
}
