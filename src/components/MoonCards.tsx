import type { ReactNode } from 'react'
import { Counter } from './Counter'
import { cx } from '../lib/format'

export function McHead({
  icon,
  tone,
  title,
  sub,
  action,
}: {
  icon: ReactNode
  tone: 'orange' | 'navy' | 'soft'
  title: string
  sub?: string
  action?: ReactNode
}) {
  return (
    <header className="mc-card-head">
      <span className={cx('mc-icon', tone)} aria-hidden="true">
        {icon}
      </span>
      <div className="mc-card-id">
        <h2 className="mc-card-title">{title}</h2>
        {sub && <div className="mc-card-sub">{sub}</div>}
      </div>
      {action && <div className="mc-card-tools">{action}</div>}
    </header>
  )
}

export function MoonGauge({
  value,
  max,
  label,
  segments,
  ariaLabel,
}: {
  value: number
  max?: number
  label: string
  segments: { value: number; color: string; label: string }[]
  ariaLabel?: string
}) {
  const size = 240
  const cx = size / 2
  const cy = 112
  const r = 96
  const active = segments.filter((s) => s.value > 0)
  const total = Math.max(1, active.reduce((sum, s) => sum + s.value, 0))
  const gap = active.length > 1 ? 3 : 0
  let acc = 0

  const arcs = active.map((s, i) => {
    const start = (acc / total) * 180 + (i === 0 ? 0 : gap / 2)
    acc += s.value
    const end = (acc / total) * 180 - (i === active.length - 1 ? 0 : gap / 2)
    const a0 = ((180 - start) * Math.PI) / 180
    const a1 = ((180 - end) * Math.PI) / 180
    const x0 = cx + r * Math.cos(a0)
    const y0 = cy - r * Math.sin(a0)
    const x1 = cx + r * Math.cos(a1)
    const y1 = cy - r * Math.sin(a1)
    return {
      key: s.label,
      color: s.color,
      delay: i * 140,
      d: `M${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 0 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`,
    }
  })

  return (
    <div className="mc-gauge">
      <svg
        viewBox={`0 0 ${size} 128`}
        role="img"
        aria-label={`${ariaLabel ?? label} ${Math.round(value)}${max ? ` out of ${max}` : ''}`}
      >
        <path d={`M${cx - r} ${cy} A${r} ${r} 0 0 1 ${cx + r} ${cy}`} className="mc-gauge-track" />
        {arcs.map((a) => (
          <path
            key={a.key}
            d={a.d}
            className="mc-gauge-arc"
            pathLength={1}
            stroke={a.color}
            style={{ animationDelay: `${a.delay}ms` }}
          />
        ))}
      </svg>
      <div className="mc-gauge-center">
        <div className="num">
          <Counter to={value} />
          {max != null && <small>/{max}</small>}
        </div>
        <div className="label">{label}</div>
      </div>
    </div>
  )
}
