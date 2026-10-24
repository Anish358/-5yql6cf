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
import { useState } from 'react'
import Markdown from 'react-markdown'
import { api, type Accuracy, type AIReply, type DayAhead, type Vintages } from '../api'
import {
  fmtDate,
  fmtDateTime,
  fmtGW,
  fmtGWh,
  fmtMW,
  fmtShortDate,
  fmtSignedGW,
  fmtTime,
} from '../format'
import { useAsync } from '../useAsync'
import { ToolChips } from './AnalystView'
import { Card, ErrorState, Legend, Loading, Tile, TooltipBox, type TooltipRow } from './ui'

const C = {
  actual: 'var(--series-actual)',
  forecast: 'var(--series-forecast)',
  corrected: 'var(--series-corrected)',
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
      <MorningBrief key={key} deliveryDate={deliveryDate} cutoffHour={cutoffHour} />
      <DecisionTiles d={day.data} accuracy={accuracy} />
      <ForecastChart d={day.data} accuracy={accuracy} />
      {vint.data && <VintageChart v={vint.data} d={day.data} />}
      <HindsightTiles d={day.data} />
      <HourlyTable d={day.data} />
    </div>
  )
}

function MorningBrief({ deliveryDate, cutoffHour }: { deliveryDate: string; cutoffHour: number }) {
  const [state, setState] = useState<{ busy: boolean; reply?: AIReply; error?: string }>({ busy: false })
  const run = () => {
    setState({ busy: true })
    api
      .aiBrief(deliveryDate, cutoffHour)
      .then((reply) => setState({ busy: false, reply }))
      .catch((e: Error) => setState({ busy: false, error: e.message }))
  }
  return (
    <section className="card brief">
      <div className="card-head">
        <div>
          <h2>AI morning brief</h2>
          <p className="sub">A trader-ready summary for this delivery day, written from the data available at decision time.</p>
        </div>
        <button className="btn primary" onClick={run} disabled={state.busy}>
          {state.busy ? 'Writing…' : state.reply ? 'Regenerate' : 'Generate brief'}
        </button>
      </div>
      {state.error && <div className="msg error">{state.error}</div>}
      {state.reply && (
        <div className="md">
          <ToolChips calls={state.reply.toolCalls} />
          <Markdown>{state.reply.reply}</Markdown>
        </div>
      )}
    </section>
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
  const p90 = accuracy?.correctedShortfallBuffers.find((b) => b.coveragePct === 90)?.bufferMW
  const planning = p90 != null ? Math.max(0, d.correctedEnergyMWh - p90 * f.length) : null
  const minIdx = f.indexOf(Math.min(...f))
  const minSlot = d.slots.filter((s) => s.forecast != null)[minIdx]
  const factor = d.correction.factor

  return (
    <>
      <div className="section-label">What the desk sees at decision time</div>
      <div className="tiles">
        <Tile
          label="Elexon forecast energy"
          value={fmtGWh(d.forecastEnergyMWh)}
          hint={`${fmtGW(Math.min(...f))} – ${fmtGW(Math.max(...f))} · lowest ${minSlot ? fmtTime(minSlot.startTime) : '—'}`}
        />
        <Tile
          label="Corrected forecast energy"
          value={fmtGWh(d.correctedEnergyMWh)}
          hint={`× ${factor.toFixed(2)} learned from ${fmtShortDate(d.correction.trainingFrom)}–${fmtShortDate(d.correction.trainingTo)}`}
        />
        <Tile
          emphasis
          label="Planning wind (90% cover)"
          value={fmtGWh(planning)}
          hint={
            p90 != null
              ? `Corrected forecast less ${fmtGW(p90, 2)} every hour`
              : 'Loading accuracy…'
          }
        />
        <Tile
          label="Wind shortfall to cover"
          value={p90 != null ? fmtGWh(d.forecastEnergyMWh - (planning ?? 0)) : '—'}
          hint="Raw forecast minus planning wind: buy this from the market"
        />
      </div>
    </>
  )
}

function ForecastChart({ d, accuracy }: { d: DayAhead; accuracy: Accuracy | null }) {
  const p10 = accuracy?.overallCorrected.p10
  const p90 = accuracy?.overallCorrected.p90
  const byHour = new Map(d.slots.map((s) => [s.startTime, s]))
  const rows = d.actualsHalfHourly.map((a) => {
    const s = byHour.get(a.startTime)
    const c = s?.corrected ?? null
    return {
      t: a.startTime,
      label: fmtTime(a.startTime),
      actual: a.actual,
      forecast: s?.forecast ?? null,
      corrected: c,
      band: c != null && p10 != null && p90 != null ? [c - p90, c - p10] : null,
    }
  })
  const showBand = p10 != null && p90 != null

  return (
    <Card
      title="Day-ahead wind forecast vs what actually happened"
      subtitle="Forecast as available at gate closure (hourly) against metered wind generation (half-hourly)"
      right={
        <Legend
          items={[
            { label: 'Elexon forecast', color: C.forecast },
            { label: 'Corrected forecast', color: C.corrected },
            ...(showBand
              ? [{ label: 'Expected range (P10–P90)', color: C.band, kind: 'box' as const }]
              : []),
            { label: 'Actual', color: C.actual },
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
              dataKey="corrected"
              stroke={C.corrected}
              strokeWidth={2}
              strokeDasharray="6 3"
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
                  { label: 'Elexon forecast', value: fmtMW(r.forecast), color: C.forecast },
                  { label: 'Corrected', value: fmtMW(r.corrected), color: C.corrected },
                ]
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
  const mc = d.correctedMetrics
  const gain = m.mae ? (1 - mc.mae / m.mae) * 100 : 0
  return (
    <>
      <div className="section-label">In hindsight — how good was that forecast?</div>
      <div className="tiles">
        <Tile label="Actual wind energy" value={fmtGWh(d.actualEnergyMWh)} hint="Over hours with both values" />
        <Tile
          label="Elexon forecast error (MAE)"
          value={fmtGW(m.mae, 2)}
          hint={`Bias ${fmtSignedGW(m.bias)} · ${m.bias > 0 ? 'desk would have been short' : 'desk would have been long'}`}
        />
        <Tile
          emphasis
          label="Corrected forecast error (MAE)"
          value={fmtGW(mc.mae, 2)}
          hint={gain >= 0 ? `${gain.toFixed(0)}% lower than Elexon forecast` : `${(-gain).toFixed(0)}% higher on this day`}
        />
        <Tile label="Worst hour" value={fmtGW(m.maxAbsError, 2)} hint="Largest absolute miss (Elexon forecast)" />
      </div>
    </>
  )
}

function downloadCsv(d: DayAhead) {
  const header = ['start_time_utc', 'hour_uk', 'forecast_mw', 'corrected_mw', 'publish_time_utc', 'lead_hours', 'actual_mw', 'error_mw']
  const lines = d.slots.map((s) =>
    [s.startTime, fmtTime(s.startTime), s.forecast, s.corrected?.toFixed(0), s.publishTime, s.leadHours, s.actual, s.error]
      .map((v) => v ?? '')
      .join(','),
  )
  const blob = new Blob([[header.join(','), ...lines].join('\n')], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `wind-day-ahead-${d.deliveryDate}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

function HourlyTable({ d }: { d: DayAhead }) {
  return (
    <Card
      title="Hourly detail"
      subtitle="Every value used in the charts above"
      right={
        <button className="btn" onClick={() => downloadCsv(d)}>
          Download CSV
        </button>
      }
    >
      <details>
        <summary>Show table</summary>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Hour (UK)</th>
                <th>Forecast (MW)</th>
                <th>Corrected (MW)</th>
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
                  <td>{s.corrected != null ? Math.round(s.corrected).toLocaleString('en-GB') : '—'}</td>
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
