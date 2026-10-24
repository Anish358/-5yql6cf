const UK = 'Europe/London'

export const fmtMW = (v: number | null | undefined, digits = 0) =>
  v == null || Number.isNaN(v)
    ? '—'
    : `${v.toLocaleString('en-GB', { maximumFractionDigits: digits })} MW`

export const fmtGW = (mw: number | null | undefined, digits = 1) =>
  mw == null ? '—' : `${(mw / 1000).toLocaleString('en-GB', { maximumFractionDigits: digits, minimumFractionDigits: digits })} GW`

export const fmtGWh = (mwh: number | null | undefined) =>
  mwh == null ? '—' : `${(mwh / 1000).toLocaleString('en-GB', { maximumFractionDigits: 1, minimumFractionDigits: 1 })} GWh`

export const fmtSignedGW = (mw: number) => `${mw > 0 ? '+' : mw < 0 ? '−' : ''}${fmtGW(Math.abs(mw), 2)}`

export const fmtPct = (v: number | null | undefined) => (v == null ? '—' : `${v.toFixed(1)}%`)

export const fmtTime = (iso: string) =>
  new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: UK })

export const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: UK,
  })

export const fmtDate = (isoDate: string) =>
  new Date(`${isoDate}T12:00:00Z`).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: UK,
  })

export const fmtShortDate = (isoDate: string) =>
  new Date(`${isoDate}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: UK })

export const addDays = (isoDate: string, n: number) => {
  const d = new Date(`${isoDate}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

export const hourLabel = (h: number) => `${String(h).padStart(2, '0')}:00`
