import type { ReactNode } from 'react'

export function Card({
  title,
  subtitle,
  right,
  children,
}: {
  title: string
  subtitle?: ReactNode
  right?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="card">
      <div className="card-head">
        <div>
          <h2>{title}</h2>
          {subtitle && <p className="sub">{subtitle}</p>}
        </div>
        {right}
      </div>
      {children}
    </section>
  )
}

export function Tile({
  label,
  value,
  hint,
  emphasis,
}: {
  label: string
  value: ReactNode
  hint?: ReactNode
  emphasis?: boolean
}) {
  return (
    <div className={`tile${emphasis ? ' emphasis' : ''}`}>
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {hint && <div className="hint">{hint}</div>}
    </div>
  )
}

export type LegendItem = { label: string; color: string; kind?: 'line' | 'box' | 'dashed' }

export function Legend({ items }: { items: LegendItem[] }) {
  return (
    <div className="legend">
      {items.map((i) => (
        <span key={i.label}>
          <i
            className={`swatch${i.kind === 'box' ? ' box' : ''}${i.kind === 'dashed' ? ' dashed' : ''}`}
            style={{ background: i.color }}
          />
          {i.label}
        </span>
      ))}
    </div>
  )
}

export type TooltipRow = { label: string; value: string; color?: string }

export function TooltipBox({ title, rows }: { title: string; rows: TooltipRow[] }) {
  return (
    <div className="tt">
      <div className="tt-title">{title}</div>
      {rows.map((r) => (
        <div className="row" key={r.label}>
          <span>
            {r.color && <i className="dot" style={{ background: r.color }} />}
            {r.label}
          </span>
          <b>{r.value}</b>
        </div>
      ))}
    </div>
  )
}

export function Loading({ what }: { what: string }) {
  return <div className="state">Loading {what}…</div>
}

export function ErrorState({ message }: { message: string }) {
  return <div className="state error">Couldn’t load data: {message}</div>
}
