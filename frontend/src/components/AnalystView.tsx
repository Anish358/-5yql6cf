import { useEffect, useRef, useState, type FormEvent } from 'react'
import Markdown from 'react-markdown'
import { api, type ChatMessage, type ToolCall } from '../api'
import { fmtDate } from '../format'

type Turn = ChatMessage & { toolCalls?: ToolCall[]; error?: boolean }

const SUGGESTIONS = [
  'Which January days would have left us shortest, and why?',
  'Is the forecast worse at certain times of day?',
  'How much better is the corrected forecast, and can I trust it?',
  'Summarise the risk for the delivery day I am looking at.',
  'How much does accuracy improve if we wait for a later forecast run?',
]

const TOOL_LABELS: Record<string, string> = {
  get_day_ahead: 'Day-ahead data',
  get_accuracy_summary: 'Accuracy summary',
  get_daily_table: 'Daily table',
  get_lead_time_errors: 'Lead-time errors',
  get_forecast_runs: 'Forecast runs',
}

export function ToolChips({ calls }: { calls: ToolCall[] }) {
  if (!calls.length) return null
  return (
    <div className="tool-chips" aria-label="Data the analyst looked up">
      {calls.map((c, i) => (
        <span key={i} className="chip" title={JSON.stringify(c.args)}>
          {TOOL_LABELS[c.name] ?? c.name}
          {typeof c.args.delivery_date === 'string' ? ` · ${c.args.delivery_date}` : ''}
        </span>
      ))}
    </div>
  )
}

export function AnalystView({ deliveryDate, cutoffHour }: { deliveryDate: string; cutoffHour: number }) {
  const [turns, setTurns] = useState<Turn[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const chatRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = chatRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [turns, busy])

  async function ask(question: string) {
    const q = question.trim()
    if (!q || busy) return
    const history: Turn[] = [...turns, { role: 'user', content: q }]
    setTurns(history)
    setInput('')
    setBusy(true)
    try {
      const payload = history.filter((t) => !t.error).slice(-12).map(({ role, content }) => ({ role, content }))
      const res = await api.aiChat(payload, deliveryDate, cutoffHour)
      setTurns([...history, { role: 'assistant', content: res.reply, toolCalls: res.toolCalls }])
    } catch (e) {
      setTurns([...history, { role: 'assistant', content: (e as Error).message, error: true }])
    } finally {
      setBusy(false)
    }
  }

  const submit = (e: FormEvent) => {
    e.preventDefault()
    void ask(input)
  }

  return (
    <section className="card analyst">
      <div className="card-head">
        <div>
          <h2>AI analyst</h2>
          <p className="sub">
            Ask about the January data in plain English. Answers come from the same analysis as the charts, and every
            lookup is shown. Context: {fmtDate(deliveryDate)}, decision at {String(cutoffHour).padStart(2, '0')}:00.
          </p>
        </div>
        {turns.length > 0 && (
          <button className="btn" onClick={() => setTurns([])} disabled={busy}>
            New conversation
          </button>
        )}
      </div>

      <div className="chat" aria-live="polite" ref={chatRef}>
        {turns.length === 0 && (
          <div className="suggestions">
            {SUGGESTIONS.map((s) => (
              <button key={s} className="suggestion" onClick={() => void ask(s)}>
                {s}
              </button>
            ))}
          </div>
        )}
        {turns.map((t, i) => (
          <div key={i} className={`msg ${t.role}${t.error ? ' error' : ''}`}>
            {t.role === 'assistant' && t.toolCalls && <ToolChips calls={t.toolCalls} />}
            {t.role === 'assistant' && !t.error ? <Markdown>{t.content}</Markdown> : <p>{t.content}</p>}
          </div>
        ))}
        {busy && (
          <div className="msg assistant thinking">
            <span className="dots" aria-label="Analyst is working">
              <i />
              <i />
              <i />
            </span>
            Querying the data…
          </div>
        )}
      </div>

      <form className="chat-input" onSubmit={submit}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="e.g. Which hours on 20 Jan had the biggest shortfall?"
          maxLength={1000}
          aria-label="Ask the AI analyst"
        />
        <button className="btn primary" type="submit" disabled={busy || !input.trim()}>
          Ask
        </button>
      </form>
    </section>
  )
}
