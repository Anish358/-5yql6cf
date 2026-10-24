import { useState } from 'react'
import { api } from './api'
import { AccuracyView } from './components/AccuracyView'
import { DecisionView } from './components/DecisionView'
import { ErrorState, Loading } from './components/ui'
import { addDays, fmtDateTime, hourLabel } from './format'
import { useAsync } from './useAsync'

type Tab = 'decision' | 'accuracy'

const CUTOFF_HOURS = [6, 8, 9, 10, 11, 12, 14, 16, 18]

export default function App() {
  const meta = useAsync(api.meta, 'meta')
  const [tab, setTab] = useState<Tab>('decision')
  const [cutoffHour, setCutoffHour] = useState(11)
  const [deliveryDate, setDeliveryDate] = useState('2026-01-15')
  const accuracy = useAsync(() => api.accuracy(cutoffHour), `acc${cutoffHour}`)

  if (meta.error) return <ErrorState message={meta.error} />
  if (!meta.data) return <Loading what="dataset" />
  const { deliveryStart, deliveryEnd, dataFetchedAt } = meta.data

  const step = (n: number) => setDeliveryDate((d) => addDays(d, n))

  return (
    <div className="app">
      <header className="header">
        <div className="brand">
          <img src="/favicon.svg" alt="" />
          <div>
            <h1>Wind Day-Ahead Desk</h1>
            <p>GB national wind forecasts for day-ahead power purchasing · January 2026 pilot</p>
          </div>
        </div>
        <div className="source">
          Source: Elexon BMRS (WINDFOR, FUELHH)
          <br />
          Data snapshot {fmtDateTime(dataFetchedAt)} · times in UK local
        </div>
      </header>

      <nav className="toolbar" aria-label="View controls">
        <div className="tabs" role="tablist">
          <button className="tab" role="tab" aria-selected={tab === 'decision'} onClick={() => setTab('decision')}>
            Day-ahead decision
          </button>
          <button className="tab" role="tab" aria-selected={tab === 'accuracy'} onClick={() => setTab('accuracy')}>
            Forecast accuracy
          </button>
        </div>
        <div className="controls">
          {tab === 'decision' && (
            <div className="control">
              <button
                className="icon-btn"
                aria-label="Previous day"
                disabled={deliveryDate <= deliveryStart}
                onClick={() => step(-1)}
              >
                ‹
              </button>
              <label htmlFor="delivery-date">Delivery day</label>
              <input
                id="delivery-date"
                type="date"
                min={deliveryStart}
                max={deliveryEnd}
                value={deliveryDate}
                onChange={(e) => e.target.value && setDeliveryDate(e.target.value)}
              />
              <button
                className="icon-btn"
                aria-label="Next day"
                disabled={deliveryDate >= deliveryEnd}
                onClick={() => step(1)}
              >
                ›
              </button>
            </div>
          )}
          <div className="control">
            <label htmlFor="cutoff">Decision time (D-1)</label>
            <select id="cutoff" value={cutoffHour} onChange={(e) => setCutoffHour(Number(e.target.value))}>
              {CUTOFF_HOURS.map((h) => (
                <option key={h} value={h}>
                  {hourLabel(h)}
                  {h === 11 ? ' · gate closure' : ''}
                </option>
              ))}
            </select>
          </div>
        </div>
      </nav>

      <main>
        {tab === 'decision' ? (
          <DecisionView deliveryDate={deliveryDate} cutoffHour={cutoffHour} accuracy={accuracy.data} />
        ) : accuracy.error ? (
          <ErrorState message={accuracy.error} />
        ) : (
          <AccuracyView accuracy={accuracy.data} cutoffHour={cutoffHour} />
        )}
      </main>

      <footer className="footer">
        Forecast = latest WINDFOR run published at or before the decision time on D-1. Error = forecast − actual,
        compared hourly.
      </footer>
    </div>
  )
}
