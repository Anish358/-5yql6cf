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
  error: 'var(--series-error)',
  muted: 'var(--series-muted)',
  grid: 'var(--grid)',
  highlight: 'var(--highlight)',
}

const gwTick = (v: number) => `${+(v / 1000).toFixed(1)} GW`
const MARGIN = { top: 8, right: 8, bottom: 0, left: 0 }
const BAR_RADIUS: [number, number, number, number] = [4, 4, 0, 0]

export function AccuracyView({ accuracy, cutoffHour }: { accuracy: Accuracy | null; cutoffHour: number }) {
  const horizon = useAsync(() => api.horizon(6), 'h6')
  if (!accuracy) return <Loading what="accuracy analysis" />
  const o = accuracy.overall
  const p90 = accuracy.shortfallBuffers.find((b) => b.coveragePct === 90)!

  return (
    <div className="stack">
      <div className="insight">
        Across {o.n.toLocaleString('en-GB')} delivery hours ({fmtShortDate(accuracy.deliveryStart)} –{' '}
        {fmtShortDate(accuracy.deliveryEnd)}), the forecast available at {hourLabel(cutoffHour)} on D-1 was{' '}
        <strong>above actual wind in {fmtPct(o.overForecastPct)} of hours</strong>, by{' '}
        <strong>{fmtGW(o.bias, 2)} on average</strong>. Taking the raw forecast at face value would have left the
        desk systematically short; holding back <strong>{fmtGW(p90.bufferMW, 2)}</strong> covers 9 in 10 hours.
      </div>

      <div className="tiles">
        <Tile label="Mean absolute error" value={fmtGW(o.mae, 2)} hint={`${fmtPct(o.nmaePct)} of mean wind output`} />
        <Tile label="RMSE" value={fmtGW(o.rmse, 2)} hint="Penalises large misses" />
        <Tile label="Bias (forecast − actual)" value={fmtSignedGW(o.bias)} hint="Positive = over-forecast" />
        <Tile label="P90 over-forecast" value={fmtGW(o.p90, 2)} hint={`P10 ${fmtSignedGW(o.p10)} · median ${fmtSignedGW(o.p50)}`} />
        <Tile label="Worst single hour" value={fmtGW(o.maxAbsError, 2)} hint="Largest absolute miss" />
      </div>

      <BufferCard accuracy={accuracy} />
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
      subtitle="Wind assumed = forecast − buffer. Buffers are empirical percentiles of January day-ahead over-forecast errors."
    >
      <div className="tiles">
        {accuracy.shortfallBuffers.map((b) => (
          <Tile
            key={b.coveragePct}
            emphasis={b.coveragePct === 90}
            label={`Covered in ${b.coveragePct}% of hours`}
            value={fmtGW(b.bufferMW, 2)}
            hint={`${fmtGW(b.bufferMW * 24, 0)}h extra procurement per day`}
          />
        ))}
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
