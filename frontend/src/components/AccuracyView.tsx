import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { api, type Accuracy } from '../api'
import { fmtDate, fmtGW, fmtMW, fmtPct, fmtShortDate, fmtSignedGW, hourLabel } from '../format'
import { useAsync } from '../useAsync'
import { Card, Legend, Loading, Tile, TooltipBox } from './ui'

const C = {
  actual: 'var(--series-actual)',
  forecast: 'var(--series-forecast)',
  corrected: 'var(--series-corrected)',
  error: 'var(--series-error)',
  muted: 'var(--series-muted)',
  grid: 'var(--grid)',
  highlight: 'var(--highlight)',
}

const gwTick = (v: number) => `${+(v / 1000).toFixed(1)} GW`
const MARGIN = { top: 8, right: 8, bottom: 0, left: 0 }
const BAR_RADIUS: [number, number, number, number] = [4, 4, 0, 0]

export function AccuracyView({
  accuracy,
  cutoffHour,
  onSelectDay,
}: {
  accuracy: Accuracy | null
  cutoffHour: number
  onSelectDay: (date: string) => void
}) {
  const horizon = useAsync(() => api.horizon(6), 'h6')
  if (!accuracy) return <Loading what="accuracy analysis" />
  const o = accuracy.overall
  const oc = accuracy.overallCorrected
  const p90 = accuracy.shortfallBuffers.find((b) => b.coveragePct === 90)!
  const p90c = accuracy.correctedShortfallBuffers.find((b) => b.coveragePct === 90)!

  return (
    <div className="stack">
      <div className="insight">
        Across {o.n.toLocaleString('en-GB')} delivery hours ({fmtShortDate(accuracy.deliveryStart)} –{' '}
        {fmtShortDate(accuracy.deliveryEnd)}), the forecast available at {hourLabel(cutoffHour)} on D-1 was{' '}
        <strong>above actual wind in {fmtPct(o.overForecastPct)} of hours</strong>, by{' '}
        <strong>{fmtGW(o.bias, 2)} on average</strong>. Taking the raw forecast at face value would have left the
        desk systematically short. A correction learned from the previous 14 settled days cuts the error from{' '}
        <strong>{fmtGW(o.mae, 2)} to {fmtGW(oc.mae, 2)}</strong> and the buffer needed to cover 9 in 10 hours from{' '}
        <strong>
          {fmtGW(p90.bufferMW, 2)} to {fmtGW(p90c.bufferMW, 2)}
        </strong>
        .
      </div>

      <div className="tiles">
        <Tile label="Mean absolute error" value={fmtGW(o.mae, 2)} hint={`${fmtPct(o.nmaePct)} of mean wind output`} />
        <Tile label="RMSE" value={fmtGW(o.rmse, 2)} hint="Penalises large misses" />
        <Tile label="Bias (forecast − actual)" value={fmtSignedGW(o.bias)} hint="Positive = over-forecast" />
        <Tile label="P90 over-forecast" value={fmtGW(o.p90, 2)} hint={`P10 ${fmtSignedGW(o.p10)} · median ${fmtSignedGW(o.p50)}`} />
        <Tile
          emphasis
          label="Corrected forecast MAE"
          value={fmtGW(oc.mae, 2)}
          hint={`${((1 - oc.mae / o.mae) * 100).toFixed(0)}% lower · bias ${fmtSignedGW(oc.bias)}`}
        />
      </div>

      <CalendarCard accuracy={accuracy} onSelectDay={onSelectDay} />
      <BufferCard accuracy={accuracy} />
      <CorrectionCard accuracy={accuracy} />
      <DailyCharts accuracy={accuracy} />
      <div className="grid-2">
        <Card
          title="Error grows with forecast lead time"
          subtitle="MAE of every forecast run in January by hours between publish and delivery. Shaded: the lead times a day-ahead decision actually uses."
        >
          {horizon.data ? (
            <div style={{ height: 260 }}>
              <ResponsiveContainer>
                <BarChart data={horizon.data} margin={MARGIN} barCategoryGap={3}>
                  <CartesianGrid stroke={C.grid} vertical={false} />
                  <ReferenceArea x1="12–18h" x2="36–42h" fill={C.highlight} ifOverflow="extendDomain" />
                  <XAxis
                    dataKey={(b) => `${b.leadFromHours}–${b.leadToHours}h`}
                    tickLine={false}
                    axisLine={{ stroke: C.grid }}
                    interval={1}
                  />
                  <YAxis tickFormatter={gwTick} tickLine={false} axisLine={false} width={56} />
                  <Bar dataKey="mae" fill={C.error} radius={BAR_RADIUS} isAnimationActive={false} />
                  <Tooltip
                    cursor={{ fill: C.highlight }}
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null
                      const b = payload[0].payload
                      return (
                        <TooltipBox
                          title={`${b.leadFromHours}–${b.leadToHours} h ahead`}
                          rows={[
                            { label: 'MAE', value: fmtMW(b.mae), color: C.error },
                            { label: 'RMSE', value: fmtMW(b.rmse) },
                            { label: 'Bias', value: fmtMW(b.bias) },
                            { label: 'Samples', value: b.n.toLocaleString('en-GB') },
                          ]}
                        />
                      )
                    }}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <Loading what="lead-time analysis" />
          )}
        </Card>
        <Card title="Error by hour of day" subtitle="MAE of the day-ahead forecast by UK delivery hour">
          <div style={{ height: 260 }}>
            <ResponsiveContainer>
              <BarChart data={accuracy.byHourOfDay} margin={MARGIN} barCategoryGap={2}>
                <CartesianGrid stroke={C.grid} vertical={false} />
                <XAxis dataKey="hour" tickFormatter={hourLabel} interval={3} tickLine={false} axisLine={{ stroke: C.grid }} />
                <YAxis tickFormatter={gwTick} tickLine={false} axisLine={false} width={56} />
                <Bar dataKey="mae" fill={C.error} radius={BAR_RADIUS} isAnimationActive={false} />
                <Tooltip
                  cursor={{ fill: C.highlight }}
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null
                    const h = payload[0].payload
                    return (
                      <TooltipBox
                        title={`${hourLabel(h.hour)} UK`}
                        rows={[
                          { label: 'MAE', value: fmtMW(h.mae), color: C.error },
                          { label: 'Bias', value: fmtMW(h.bias) },
                          { label: 'Days', value: String(h.n) },
                        ]}
                      />
                    )
                  }}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>
      <HistogramCard accuracy={accuracy} />
    </div>
  )
}

function BufferCard({ accuracy }: { accuracy: Accuracy }) {
  return (
    <Card
      title="How much to hold back from the forecast"
      subtitle="Wind assumed = corrected forecast − buffer. Buffers are empirical percentiles of January day-ahead over-forecast errors."
    >
      <div className="tiles">
        {accuracy.correctedShortfallBuffers.map((b, i) => (
          <Tile
            key={b.coveragePct}
            emphasis={b.coveragePct === 90}
            label={`Covered in ${b.coveragePct}% of hours`}
            value={fmtGW(b.bufferMW, 2)}
            hint={`vs ${fmtGW(accuracy.shortfallBuffers[i].bufferMW, 2)} using the raw Elexon forecast`}
          />
        ))}
      </div>
    </Card>
  )
}

function CorrectionCard({ accuracy }: { accuracy: Accuracy }) {
  const rows = accuracy.daily.map((d) => ({ ...d, label: fmtShortDate(d.date) }))
  return (
    <Card
      title="Corrected vs Elexon forecast, day by day"
      subtitle="Daily MAE. The correction scales each day's forecast by actual ÷ forecast over the 14 days fully metered before the decision — no future data."
      right={
        <Legend
          items={[
            { label: 'Elexon forecast', color: C.forecast },
            { label: 'Corrected forecast', color: C.corrected },
          ]}
        />
      }
    >
      <div style={{ height: 240 }}>
        <ResponsiveContainer>
          <LineChart data={rows} margin={MARGIN}>
            <CartesianGrid stroke={C.grid} vertical={false} />
            <XAxis dataKey="label" interval={4} tickLine={false} axisLine={{ stroke: C.grid }} />
            <YAxis tickFormatter={gwTick} tickLine={false} axisLine={false} width={56} />
            <Line dataKey="mae" stroke={C.forecast} strokeWidth={2} dot={false} isAnimationActive={false} />
            <Line dataKey="correctedMae" stroke={C.corrected} strokeWidth={2} dot={false} isAnimationActive={false} />
            <Tooltip
              cursor={{ stroke: 'var(--text-3)', strokeDasharray: '3 3' }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null
                const d = payload[0].payload
                return (
                  <TooltipBox
                    title={fmtDate(d.date)}
                    rows={[
                      { label: 'Elexon MAE', value: fmtGW(d.mae, 2), color: C.forecast },
                      { label: 'Corrected MAE', value: fmtGW(d.correctedMae, 2), color: C.corrected },
                      { label: 'Scale factor', value: `× ${d.correctionFactor.toFixed(2)}` },
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

const HEAT = ['#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95', '#0d366b']
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function CalendarCard({ accuracy, onSelectDay }: { accuracy: Accuracy; onSelectDay: (d: string) => void }) {
  const days = accuracy.daily
  const max = Math.max(...days.map((d) => d.mae))
  const min = Math.min(...days.map((d) => d.mae))
  const step = (v: number) => Math.min(HEAT.length - 1, Math.floor(((v - min) / (max - min || 1)) * HEAT.length))
  const offset = (new Date(`${days[0].date}T12:00:00Z`).getUTCDay() + 6) % 7
  return (
    <Card
      title="Which days went wrong?"
      subtitle="Daily MAE of the Elexon day-ahead forecast. Click a day to open it in the decision view."
      right={
        <div className="heat-legend">
          <span>{fmtGW(min, 1)}</span>
          {HEAT.map((c) => (
            <i key={c} style={{ background: c }} />
          ))}
          <span>{fmtGW(max, 1)}</span>
        </div>
      }
    >
      <div className="calendar">
        {WEEKDAYS.map((w) => (
          <div key={w} className="calendar-head">
            {w}
          </div>
        ))}
        {Array.from({ length: offset }, (_, i) => (
          <div key={`pad${i}`} />
        ))}
        {days.map((d) => {
          const k = step(d.mae)
          return (
            <button
              key={d.date}
              className="calendar-cell"
              style={{ background: HEAT[k], color: k >= 3 ? '#fff' : '#0b0b0b' }}
              onClick={() => onSelectDay(d.date)}
              title={`${fmtDate(d.date)}: MAE ${fmtGW(d.mae, 2)}, bias ${fmtSignedGW(d.bias)}`}
            >
              <span className="calendar-day">{fmtShortDate(d.date)}</span>
              <span className="calendar-val">{fmtGW(d.mae, 1)}</span>
            </button>
          )
        })}
      </div>
    </Card>
  )
}

function DailyCharts({ accuracy }: { accuracy: Accuracy }) {
  const rows = accuracy.daily.map((d) => ({ ...d, label: fmtShortDate(d.date) }))
  return (
    <div className="grid-2">
      <Card
        title="Daily average: forecast vs actual"
        subtitle="Mean of hourly values per delivery day"
        right={
          <Legend
            items={[
              { label: 'Forecast', color: C.forecast },
              { label: 'Actual', color: C.actual },
            ]}
          />
        }
      >
        <div style={{ height: 260 }}>
          <ResponsiveContainer>
            <LineChart data={rows} margin={MARGIN}>
              <CartesianGrid stroke={C.grid} vertical={false} />
              <XAxis dataKey="label" interval={4} tickLine={false} axisLine={{ stroke: C.grid }} />
              <YAxis tickFormatter={gwTick} tickLine={false} axisLine={false} width={56} />
              <Line dataKey="meanForecast" stroke={C.forecast} strokeWidth={2} dot={false} isAnimationActive={false} />
              <Line dataKey="meanActual" stroke={C.actual} strokeWidth={2} dot={false} isAnimationActive={false} />
              <Tooltip
                cursor={{ stroke: 'var(--text-3)', strokeDasharray: '3 3' }}
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null
                  const d = payload[0].payload
                  return (
                    <TooltipBox
                      title={fmtDate(d.date)}
                      rows={[
                        { label: 'Forecast', value: fmtGW(d.meanForecast, 2), color: C.forecast },
                        { label: 'Actual', value: fmtGW(d.meanActual, 2), color: C.actual },
                        { label: 'MAE', value: fmtGW(d.mae, 2) },
                      ]}
                    />
                  )
                }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>
      <Card title="Daily forecast bias" subtitle="Mean (forecast − actual) per day; above zero = wind under-delivered">
        <div style={{ height: 260 }}>
          <ResponsiveContainer>
            <BarChart data={rows} margin={MARGIN} barCategoryGap={2}>
              <CartesianGrid stroke={C.grid} vertical={false} />
              <XAxis dataKey="label" interval={4} tickLine={false} axisLine={{ stroke: C.grid }} />
              <YAxis tickFormatter={gwTick} tickLine={false} axisLine={false} width={56} />
              <ReferenceLine y={0} stroke="var(--text-3)" />
              <Bar dataKey="bias" isAnimationActive={false} radius={BAR_RADIUS}>
                {rows.map((r) => (
                  <Cell key={r.date} fill={r.bias >= 0 ? C.error : C.muted} />
                ))}
              </Bar>
              <Tooltip
                cursor={{ fill: C.highlight }}
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null
                  const d = payload[0].payload
                  return (
                    <TooltipBox
                      title={fmtDate(d.date)}
                      rows={[
                        { label: 'Bias', value: fmtSignedGW(d.bias) },
                        { label: 'MAE', value: fmtGW(d.mae, 2) },
                        { label: 'Worst hour', value: fmtGW(d.maxAbsError, 2) },
                      ]}
                    />
                  )
                }}
              />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>
    </div>
  )
}

function HistogramCard({ accuracy }: { accuracy: Accuracy }) {
  const rows = accuracy.histogram.map((h) => ({ ...h, label: `${h.binStart / 1000}` }))
  const total = rows.reduce((s, r) => s + r.count, 0)
  return (
    <Card
      title="Distribution of hourly errors"
      subtitle="Forecast − actual, 1 GW bins. Right of zero = wind under-delivered vs forecast (desk short)."
    >
      <div style={{ height: 240 }}>
        <ResponsiveContainer>
          <BarChart data={rows} margin={MARGIN} barCategoryGap={2}>
            <CartesianGrid stroke={C.grid} vertical={false} />
            <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: C.grid }} unit=" GW" />
            <YAxis tickLine={false} axisLine={false} width={40} />
            <Bar dataKey="count" isAnimationActive={false} radius={BAR_RADIUS}>
              {rows.map((r) => (
                <Cell key={r.binStart} fill={r.binStart >= 0 ? C.error : C.muted} />
              ))}
            </Bar>
            <Tooltip
              cursor={{ fill: C.highlight }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null
                const r = payload[0].payload
                return (
                  <TooltipBox
                    title={`${fmtSignedGW(r.binStart)} to ${fmtSignedGW(r.binEnd)}`}
                    rows={[
                      { label: 'Hours', value: String(r.count) },
                      { label: 'Share', value: fmtPct((100 * r.count) / total) },
                    ]}
                  />
                )
              }}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Card>
  )
}
