import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { api, type Accuracy, type DayAhead, type Vintages } from '../api'
import {
  fmtDate,
  fmtDateTime,
  fmtGW,
  fmtGWh,
  fmtMW,
  fmtPct,
  fmtSignedGW,
  fmtTime,
} from '../format'
import { useAsync } from '../useAsync'
import { Card, ErrorState, Legend, Loading, Tile, TooltipBox, type TooltipRow } from './ui'

const C = {
  actual: 'var(--series-actual)',
  forecast: 'var(--series-forecast)',
  band: 'var(--band)',
  muted: 'var(--series-muted)',
  grid: 'var(--grid)',
}

const gwTick = (v: number) => `${+(v / 1000).toFixed(1)} GW`

export function DecisionView({
  deliveryDate,
  cutoffHour,
  accuracy,
}: {
  deliveryDate: string
  cutoffHour: number
  accuracy: Accuracy | null
}) {
  const key = `${deliveryDate}|${cutoffHour}`
  const day = useAsync(() => api.dayAhead(deliveryDate, cutoffHour), key)
  const vint = useAsync(() => api.vintages(deliveryDate, cutoffHour), key)

  if (day.error) return <ErrorState message={day.error} />
  if (!day.data) return <Loading what="day-ahead forecast" />

  return (
    <div className="stack">
      <DecisionBanner d={day.data} />
      <DecisionTiles d={day.data} accuracy={accuracy} />
      <ForecastChart d={day.data} accuracy={accuracy} />
      {vint.data && <VintageChart v={vint.data} d={day.data} />}
      <HindsightTiles d={day.data} />
      <HourlyTable d={day.data} />
    </div>
  )
}

function DecisionBanner({ d }: { d: DayAhead }) {
  const leads = d.slots.map((s) => s.leadHours).filter((x): x is number => x != null)
  return (
    <div className="banner" role="note">
      <div>
        <span className="k">Delivery day</span>
        <span className="v">{fmtDate(d.deliveryDate)}</span>
      </div>
      <div>
        <span className="k">Decision (gate closure)</span>
        <span className="v">{fmtDateTime(d.decisionCutoff)}</span>
      </div>
      <div>
        <span className="k">Latest forecast available</span>
        <span className="v">
          {d.forecastPublishTime ? `Published ${fmtDateTime(d.forecastPublishTime)}` : 'None'}
        </span>
      </div>
      {leads.length > 0 && (
        <div>
          <span className="k">Forecast lead time</span>
          <span className="v">
            {Math.min(...leads).toFixed(1)}–{Math.max(...leads).toFixed(1)} h ahead
          </span>
        </div>
      )}
    </div>
  )
}

function DecisionTiles({ d, accuracy }: { d: DayAhead; accuracy: Accuracy | null }) {
  const f = d.slots.map((s) => s.forecast).filter((x): x is number => x != null)
  const p90 = accuracy?.shortfallBuffers.find((b) => b.coveragePct === 90)?.bufferMW
  const planning = p90 != null ? Math.max(0, d.forecastEnergyMWh - p90 * f.length) : null
  const minIdx = f.indexOf(Math.min(...f))
  const minSlot = d.slots.filter((s) => s.forecast != null)[minIdx]

  return (
    <>
      <div className="section-label">What the desk sees at decision time</div>
      <div className="tiles">
        <Tile
          label="Forecast wind energy"
          value={fmtGWh(d.forecastEnergyMWh)}
          hint={`Average ${fmtGW(d.forecastEnergyMWh / Math.max(1, f.length))}`}
        />
        <Tile
          label="Forecast range"
          value={`${fmtGW(Math.min(...f))} – ${fmtGW(Math.max(...f))}`}
          hint={minSlot ? `Lowest hour starts ${fmtTime(minSlot.startTime)}` : undefined}
        />
        <Tile
          emphasis
          label="Planning wind (90% cover)"
          value={fmtGWh(planning)}
          hint={
            p90 != null
              ? `Forecast less ${fmtGW(p90, 2)} every hour (Jan P90 over-forecast)`
              : 'Loading accuracy…'
          }
        />
        <Tile
          label="Extra energy vs raw forecast"
          value={p90 != null ? fmtGWh(p90 * f.length) : '—'}
          hint="To source from the market to stay covered 9 days in 10"
        />
      </div>
    </>
  )
}

function ForecastChart({ d, accuracy }: { d: DayAhead; accuracy: Accuracy | null }) {
  const p10 = accuracy?.overall.p10
  const p90 = accuracy?.overall.p90
  const byHour = new Map(d.slots.map((s) => [s.startTime, s]))
  const rows = d.actualsHalfHourly.map((a) => {
    const s = byHour.get(a.startTime)
    const f = s?.forecast ?? null
    return {
      t: a.startTime,
      label: fmtTime(a.startTime),
      actual: a.actual,
      forecast: f,
      band: f != null && p10 != null && p90 != null ? [f - p90, f - p10] : null,
    }
  })
  const showBand = p10 != null && p90 != null

  return (
    <Card
      title="Day-ahead wind forecast vs what actually happened"
      subtitle="Forecast as available at gate closure (hourly) against metered wind generation (half-hourly), GW"
      right={
        <Legend
          items={[
            { label: 'Forecast at decision time', color: C.forecast },
            ...(showBand
              ? [{ label: 'Expected range (P10–P90 of Jan errors)', color: C.band, kind: 'box' as const }]
              : []),
            { label: 'Actual generation', color: C.actual },
          ]}
        />
      }
    >
      <div style={{ height: 340 }}>
        <ResponsiveContainer>
          <ComposedChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke={C.grid} vertical={false} />
            <XAxis dataKey="label" interval={5} tickLine={false} axisLine={{ stroke: C.grid }} />
            <YAxis tickFormatter={gwTick} tickLine={false} axisLine={false} width={56} />
            {showBand && (
              <Area
                dataKey="band"
                stroke="none"
                fill={C.band}
                connectNulls
                isAnimationActive={false}
                activeDot={false}
              />
            )}
            <Line
              dataKey="forecast"
              stroke={C.forecast}
              strokeWidth={2}
              dot={false}
              connectNulls
              isAnimationActive={false}
            />
            <Line
              dataKey="actual"
              stroke={C.actual}
              strokeWidth={2}
              dot={false}
              isAnimationActive={false}
            />
            <Tooltip
              cursor={{ stroke: 'var(--text-3)', strokeDasharray: '3 3' }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null
                const r = payload[0].payload as (typeof rows)[number]
                const rowsOut: TooltipRow[] = [
                  { label: 'Actual', value: fmtMW(r.actual), color: C.actual },
                  { label: 'Forecast', value: fmtMW(r.forecast), color: C.forecast },
                ]
                if (r.forecast != null && r.actual != null)
                  rowsOut.push({ label: 'Error (F − A)', value: fmtMW(r.forecast - r.actual) })
                if (r.band)
                  rowsOut.push({
                    label: 'Expected range',
                    value: `${fmtGW(r.band[0])} – ${fmtGW(r.band[1])}`,
                  })
                return <TooltipBox title={r.label} rows={rowsOut} />
              }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </Card>
  )
}

function VintageChart({ v, d }: { v: Vintages; d: DayAhead }) {
  const actualByT = new Map(d.slots.map((s) => [s.startTime, s.actual]))
  const times = d.slots.map((s) => s.startTime)
  const rows = times.map((t) => {
    const row: Record<string, number | string | null> = {
      t,
      label: fmtTime(t),
      actual: actualByT.get(t) ?? null,
    }
    v.vintages.forEach((vi, i) => {
      row[`v${i}`] = vi.points.find((p) => p.startTime === t)?.forecast ?? null
    })
    return row
  })
  const decisionIdx = v.vintages.findIndex((x) => x.publishTime === v.decisionPublishTime)
  const lastIdx = v.vintages.length - 1

  return (
    <Card
      title="How the forecast evolved"
      subtitle={`${v.vintages.length} forecast runs covered this day. Runs published after gate closure arrive too late to trade on.`}
      right={
        <Legend
          items={[
            { label: 'Used for decision', color: C.forecast },
            { label: 'Earlier runs', color: C.muted },
            { label: 'Later runs (after gate closure)', color: C.muted, kind: 'dashed' },
            { label: 'Actual', color: C.actual },
          ]}
        />
      }
    >
      <div style={{ height: 280 }}>
        <ResponsiveContainer>
          <LineChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke={C.grid} vertical={false} />
            <XAxis dataKey="label" interval={2} tickLine={false} axisLine={{ stroke: C.grid }} />
            <YAxis tickFormatter={gwTick} tickLine={false} axisLine={false} width={56} />
            {v.vintages.map((vi, i) =>
              i === decisionIdx ? null : (
                <Line
                  key={vi.publishTime}
                  dataKey={`v${i}`}
                  stroke={C.muted}
                  strokeWidth={1.25}
                  strokeDasharray={vi.afterCutoff ? '4 3' : undefined}
                  dot={false}
                  isAnimationActive={false}
                  activeDot={false}
                />
              ),
            )}
            {decisionIdx >= 0 && (
              <Line
                dataKey={`v${decisionIdx}`}
                stroke={C.forecast}
                strokeWidth={2.5}
                dot={false}
                isAnimationActive={false}
              />
            )}
            <Line dataKey="actual" stroke={C.actual} strokeWidth={2} dot={false} isAnimationActive={false} />
            <Tooltip
              cursor={{ stroke: 'var(--text-3)', strokeDasharray: '3 3' }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null
                const r = payload[0].payload as Record<string, number | null | string>
                const vals = v.vintages
                  .map((_, i) => r[`v${i}`])
                  .filter((x): x is number => typeof x === 'number')
                return (
                  <TooltipBox
                    title={String(r.label)}
                    rows={[
                      { label: 'Actual', value: fmtMW(r.actual as number | null), color: C.actual },
                      {
                        label: 'Decision forecast',
                        value: fmtMW(decisionIdx >= 0 ? (r[`v${decisionIdx}`] as number | null) : null),
                        color: C.forecast,
                      },
                      { label: 'Final run', value: fmtMW(r[`v${lastIdx}`] as number | null) },
                      {
                        label: 'Spread of all runs',
                        value: vals.length ? `${fmtGW(Math.min(...vals))} – ${fmtGW(Math.max(...vals))}` : '—',
                      },
                    ]}
                  />
                )
              }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </Card>
  )
}

function HindsightTiles({ d }: { d: DayAhead }) {
  const m = d.metrics
  return (
    <>
      <div className="section-label">In hindsight — how good was that forecast?</div>
      <div className="tiles">
        <Tile label="Actual wind energy" value={fmtGWh(d.actualEnergyMWh)} hint="Over hours with both values" />
        <Tile label="Mean absolute error" value={fmtGW(m.mae, 2)} hint={`${fmtPct(m.nmaePct)} of mean actual`} />
        <Tile
          label="Bias (forecast − actual)"
          value={fmtSignedGW(m.bias)}
          hint={m.bias > 0 ? 'Over-forecast: desk would have been short' : 'Under-forecast: desk would have been long'}
        />
        <Tile label="Worst hour" value={fmtGW(m.maxAbsError, 2)} hint="Largest absolute miss" />
      </div>
    </>
  )
}

function HourlyTable({ d }: { d: DayAhead }) {
  return (
    <Card title="Hourly detail" subtitle="Every value used in the charts above">
      <details>
        <summary>Show table</summary>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Hour (UK)</th>
                <th>Forecast (MW)</th>
                <th>Published</th>
                <th>Lead (h)</th>
                <th>Actual (MW)</th>
                <th>Error (MW)</th>
              </tr>
            </thead>
            <tbody>
              {d.slots.map((s) => (
                <tr key={s.startTime}>
                  <td>{fmtTime(s.startTime)}</td>
                  <td>{s.forecast?.toLocaleString('en-GB') ?? '—'}</td>
                  <td>{s.publishTime ? fmtDateTime(s.publishTime) : '—'}</td>
                  <td>{s.leadHours?.toFixed(1) ?? '—'}</td>
                  <td>{s.actual?.toLocaleString('en-GB') ?? '—'}</td>
                  <td>{s.error?.toLocaleString('en-GB') ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </Card>
  )
}
