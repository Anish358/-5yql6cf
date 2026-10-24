import { useState } from 'react'
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { api, type Accuracy } from '../api'
import { fmtDate, fmtGW, fmtGWh, fmtMW, fmtTime } from '../format'
import { useAsync } from '../useAsync'
import { Card, ErrorState, Legend, Loading, Tile, TooltipBox } from './ui'

const C = {
  wind: 'var(--series-corrected)',
  buy: 'var(--series-buy)',
  need: 'var(--series-actual)',
  demand: 'var(--text-2)',
  grid: 'var(--grid)',
}

// Illustrative GB winter weekday demand shape by UK hour (mean = 1), not client data.
const WINTER_SHAPE = [
  0.82, 0.78, 0.76, 0.75, 0.76, 0.8, 0.9, 1.02, 1.09, 1.1, 1.09, 1.07, 1.05, 1.04, 1.04, 1.07,
  1.14, 1.22, 1.21, 1.15, 1.08, 1.0, 0.93, 0.86,
]
const shapeMean = WINTER_SHAPE.reduce((a, b) => a + b, 0) / WINTER_SHAPE.length

const gwTick = (v: number) => `${+(v / 1000).toFixed(1)} GW`

export function ProcurementView({
  deliveryDate,
  cutoffHour,
  accuracy,
}: {
  deliveryDate: string
  cutoffHour: number
  accuracy: Accuracy | null
}) {
  const [demandGW, setDemandGW] = useState(32)
  const [profile, setProfile] = useState<'flat' | 'winter'>('winter')
  const [windShare, setWindShare] = useState(100)
  const [coverage, setCoverage] = useState(90)
  const day = useAsync(() => api.dayAhead(deliveryDate, cutoffHour), `${deliveryDate}|${cutoffHour}`)

  if (day.error) return <ErrorState message={day.error} />
  if (!day.data || !accuracy) return <Loading what="procurement inputs" />

  const buffer =
    accuracy.correctedShortfallBuffers.find((b) => b.coveragePct === coverage)?.bufferMW ?? 0
  const share = windShare / 100

  const rows = day.data.slots.map((s) => {
    const h = new Date(s.startTime).toLocaleString('en-GB', { hour: 'numeric', hour12: false, timeZone: 'Europe/London' })
    const shape = profile === 'winter' ? WINTER_SHAPE[Number(h) % 24] / shapeMean : 1
    const demand = demandGW * 1000 * shape
    const plannedWind = Math.max(0, share * ((s.corrected ?? 0) - buffer))
    const toBuy = Math.max(0, demand - plannedWind)
    const naiveBuy = Math.max(0, demand - share * (s.forecast ?? 0))
    const need = s.actual != null ? Math.max(0, demand - share * s.actual) : null
    return {
      t: s.startTime,
      label: fmtTime(s.startTime),
      demand,
      plannedWind: Math.min(plannedWind, demand),
      toBuy,
      need,
      actualWind: s.actual != null ? Math.min(demand, share * s.actual) : null,
      short: need != null ? Math.max(0, need - toBuy) : null,
      naiveShort: need != null ? Math.max(0, need - naiveBuy) : null,
      long: need != null ? Math.max(0, toBuy - need) : null,
    }
  })

  const sum = (k: 'toBuy' | 'short' | 'naiveShort' | 'long' | 'demand') =>
    rows.reduce((a, r) => a + (r[k] ?? 0), 0)
  const hoursShort = rows.filter((r) => (r.short ?? 0) > 0).length
  const naiveHoursShort = rows.filter((r) => (r.naiveShort ?? 0) > 0).length

  return (
    <div className="stack">
      <Card
        title="Procurement plan inputs"
        subtitle={`Delivery ${fmtDate(deliveryDate)}. Wind is national GB wind × your share; demand is yours to enter.`}
      >
        <div className="form-row">
          <label className="field">
            <span>Average demand</span>
            <div className="input-unit">
              <input
                type="number"
                min={1}
                max={60}
                step={0.5}
                value={demandGW}
                onChange={(e) => setDemandGW(Math.max(0, Number(e.target.value)))}
              />
              <em>GW</em>
            </div>
          </label>
          <label className="field">
            <span>Demand profile</span>
            <select value={profile} onChange={(e) => setProfile(e.target.value as 'flat' | 'winter')}>
              <option value="winter">Winter weekday (illustrative)</option>
              <option value="flat">Flat</option>
            </select>
          </label>
          <label className="field">
            <span>Share of national wind</span>
            <div className="input-unit">
              <input
                type="number"
                min={1}
                max={100}
                value={windShare}
                onChange={(e) => setWindShare(Math.min(100, Math.max(1, Number(e.target.value))))}
              />
              <em>%</em>
            </div>
          </label>
          <label className="field">
            <span>Risk appetite</span>
            <select value={coverage} onChange={(e) => setCoverage(Number(e.target.value))}>
              {[50, 80, 90, 95].map((q) => (
                <option key={q} value={q}>
                  Cover {q}% of hours (P{q})
                </option>
              ))}
            </select>
          </label>
        </div>
      </Card>

      <div className="section-label">Plan at gate closure</div>
      <div className="tiles">
        <Tile emphasis label="Energy to buy day-ahead" value={fmtGWh(sum('toBuy'))} hint={`of ${fmtGWh(sum('demand'))} demand`} />
        <Tile label="Peak hourly purchase" value={fmtGW(Math.max(...rows.map((r) => r.toBuy)), 2)} />
        <Tile
          label="Wind relied on"
          value={fmtGWh(sum('demand') - sum('toBuy'))}
          hint={`Corrected forecast less ${fmtGW(buffer * share, 2)} buffer each hour`}
        />
      </div>

      <Card
        title="Hourly purchase plan"
        subtitle="Bars stack to demand: wind you plan on + power to buy. Line: wind that actually came — below the green bar means the plan was short."
        right={
          <Legend
            items={[
              { label: 'Planned wind', color: C.wind, kind: 'box' },
              { label: 'Buy day-ahead', color: C.buy, kind: 'box' },
              { label: 'Actual wind (hindsight)', color: C.need },
            ]}
          />
        }
      >
        <div style={{ height: 320 }}>
          <ResponsiveContainer>
            <ComposedChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap={2}>
              <CartesianGrid stroke={C.grid} vertical={false} />
              <XAxis dataKey="label" interval={2} tickLine={false} axisLine={{ stroke: C.grid }} />
              <YAxis tickFormatter={gwTick} tickLine={false} axisLine={false} width={56} />
              <Bar dataKey="plannedWind" stackId="d" fill={C.wind} isAnimationActive={false} />
              <Bar dataKey="toBuy" stackId="d" fill={C.buy} radius={[4, 4, 0, 0]} isAnimationActive={false} />
              <Line dataKey="actualWind" stroke={C.need} strokeWidth={2} dot={false} isAnimationActive={false} />
              <Tooltip
                cursor={{ fill: 'var(--highlight)' }}
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null
                  const r = payload[0].payload as (typeof rows)[number]
                  return (
                    <TooltipBox
                      title={r.label}
                      rows={[
                        { label: 'Demand', value: fmtMW(r.demand) },
                        { label: 'Planned wind', value: fmtMW(r.plannedWind), color: C.wind },
                        { label: 'Buy day-ahead', value: fmtMW(r.toBuy), color: C.buy },
                        { label: 'Actual wind', value: fmtMW(r.actualWind), color: C.need },
                        { label: 'Needed to buy', value: fmtMW(r.need) },
                        {
                          label: (r.short ?? 0) > 0 ? 'Short by' : 'Long by',
                          value: fmtMW((r.short ?? 0) > 0 ? r.short : r.long),
                        },
                      ]}
                    />
                  )
                }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <div className="section-label">In hindsight — how would this plan have done?</div>
      <div className="tiles">
        <Tile
          label="Hours short (this plan)"
          value={`${hoursShort} / ${rows.length}`}
          hint={`${fmtGWh(sum('short'))} to buy in balancing / intraday`}
        />
        <Tile
          label="Hours short (raw forecast, no buffer)"
          value={`${naiveHoursShort} / ${rows.length}`}
          hint={`${fmtGWh(sum('naiveShort'))} short`}
        />
        <Tile label="Over-bought energy" value={fmtGWh(sum('long'))} hint="Cost of insurance: resold intraday" />
      </div>
    </div>
  )
}
