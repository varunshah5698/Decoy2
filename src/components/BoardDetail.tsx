import { useId, type CSSProperties, type ReactNode } from 'react'
import type { RiskLevel } from '../lib/types'

export const levelColor: Record<RiskLevel, string> = {
  CRITICAL: 'var(--bd-crit)',
  HIGH: 'var(--bd-high)',
  MEDIUM: 'var(--bd-med)',
  LOW: 'var(--bd-low)',
}

export const levelLabel: Record<RiskLevel, string> = {
  CRITICAL: 'Critical',
  HIGH: 'High',
  MEDIUM: 'Medium',
  LOW: 'Low',
}

const clampPct = (value: number, max: number) => {
  if (!Number.isFinite(value) || max <= 0) return 0
  return Math.max(0, Math.min(100, (value / max) * 100))
}

/* ---------- dial ---------- */

export function BoardDial({
  value,
  max = 100,
  color = 'var(--bd-crit)',
  display,
  label,
  sub,
  size = 168,
  stroke = 10,
  ghost = false,
}: {
  value: number
  max?: number
  color?: string
  display: string
  label: string
  sub?: string
  size?: number
  stroke?: number
  ghost?: boolean
}) {
  const uid = useId().replace(/:/g, '')
  const gradId = `bd-dial-${uid}`
  const center = size / 2
  const radius = (size - stroke * 2 - 14) / 2
  const dash = (clampPct(value, max) / 100) * 75
  const ticks = 30

  return (
    <div
      className={ghost ? 'bd-dial is-ghost' : 'bd-dial'}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <defs>
          <linearGradient id={gradId} x1="0" y1="1" x2="1" y2="0">
            <stop offset="0" stopColor={color} stopOpacity="0.55" />
            <stop offset="1" stopColor={color} />
          </linearGradient>
        </defs>
        {Array.from({ length: ticks }, (_, i) => {
          const angle = 135 + (270 / (ticks - 1)) * i
          const major = i % 5 === 0
          const inner = radius + stroke * 0.95
          const outer = radius + stroke * 1.55 + (major ? 4 : 0)
          const rad = (angle * Math.PI) / 180
          return (
            <line
              key={i}
              x1={center + Math.cos(rad) * inner}
              y1={center + Math.sin(rad) * inner}
              x2={center + Math.cos(rad) * outer}
              y2={center + Math.sin(rad) * outer}
              className={major ? 'bd-dial-tick is-major' : 'bd-dial-tick'}
            />
          )
        })}
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          className="bd-dial-track"
          strokeWidth={stroke}
          strokeLinecap="round"
          pathLength={100}
          strokeDasharray="75 100"
          transform={`rotate(135 ${center} ${center})`}
        />
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke={`url(#${gradId})`}
          className="bd-dial-fill"
          strokeWidth={stroke}
          strokeLinecap="round"
          pathLength={100}
          transform={`rotate(135 ${center} ${center})`}
          style={{ '--bd-dash': `${dash.toFixed(2)} 100` } as CSSProperties}
        />
      </svg>
      <div className="bd-dial-center">
        <strong style={{ color: ghost ? 'var(--bd-muted)' : color, fontSize: Math.round(size * 0.185) }}>
          {display}
        </strong>
        <span>{label}</span>
        {sub && <small>{sub}</small>}
      </div>
    </div>
  )
}

/* ---------- meters ---------- */

export function BoardMeter({
  label,
  value,
  max = 100,
  display,
  hint,
  color = 'var(--bd-orange)',
  index = 0,
}: {
  label: string
  value: number
  max?: number
  display: string
  hint?: string
  color?: string
  index?: number
}) {
  const width = clampPct(value, max)
  return (
    <div className="bd-meter" style={{ '--bd-i': index } as CSSProperties}>
      <div className="bd-meter-top">
        <span>{label}</span>
        <b>{display}</b>
      </div>
      <div className="bd-meter-track">
        <i style={{ '--bd-w': `${width.toFixed(1)}%`, background: color } as CSSProperties} />
      </div>
      {hint && <small>{hint}</small>}
    </div>
  )
}

/* ---------- score composition ---------- */

export function BoardComposition({
  segments,
  total = 100,
  caption,
}: {
  segments: { label: string; value: number; color: string }[]
  total?: number
  caption?: string
}) {
  const visible = segments.filter((segment) => segment.value > 0.05)
  return (
    <div className="bd-comp">
      <div className="bd-comp-top">
        <strong>{caption ?? 'Score composition'}</strong>
        <span className="mono">{visible.reduce((sum, segment) => sum + segment.value, 0).toFixed(0)} / {total} points</span>
      </div>
      <div className="bd-comp-track" aria-hidden="true">
        {visible.length === 0 ? (
          <i className="is-empty" style={{ width: '100%' }} />
        ) : (
          visible.map((segment, i) => (
            <i
              key={segment.label}
              title={`${segment.label} · ${segment.value.toFixed(1)} points`}
              style={
                {
                  width: `${(segment.value / total) * 100}%`,
                  background: segment.color,
                  '--bd-i': i,
                } as CSSProperties
              }
            />
          ))
        )}
      </div>
      <div className="bd-comp-legend">
        {segments.map((segment) => (
          <span key={segment.label}>
            <i style={{ background: segment.color }} />
            {segment.label}
            <b>{segment.value.toFixed(0)}</b>
          </span>
        ))}
      </div>
    </div>
  )
}

/* ---------- factor bars ---------- */

export function BoardFactors({
  rows,
}: {
  rows: { label: string; hint: string; value: number; max: number; color: string }[]
}) {
  return (
    <div className="bd-factors">
      {rows.map((row, i) => (
        <div className="bd-factor" key={row.label} style={{ '--bd-i': i } as CSSProperties}>
          <div className="bd-factor-head">
            <span>{row.label}</span>
            <b>
              {row.value.toFixed(1)}
              <small> / {row.max}</small>
            </b>
          </div>
          <div className="bd-factor-track">
            <i
              style={
                {
                  '--bd-w': `${clampPct(row.value, row.max).toFixed(1)}%`,
                  background: row.color,
                } as CSSProperties
              }
            />
          </div>
          <small>{row.hint}</small>
        </div>
      ))}
    </div>
  )
}

/* ---------- stat tiles ---------- */

export function BoardStat({
  label,
  value,
  sub,
  tone,
}: {
  label: string
  value: ReactNode
  sub?: string
  tone?: 'orange' | 'navy' | 'green'
}) {
  return (
    <div className={tone ? `bd-stat is-${tone}` : 'bd-stat'}>
      <span>{label}</span>
      <strong>{value}</strong>
      {sub && <small>{sub}</small>}
    </div>
  )
}

/* ---------- score row ---------- */

export function BoardRiskRow({
  title,
  meta,
  badge,
  value,
  max = 100,
  display,
  color = 'var(--bd-crit)',
  muted = false,
}: {
  title: ReactNode
  meta: ReactNode
  badge?: ReactNode
  value: number
  max?: number
  display: string
  color?: string
  muted?: boolean
}) {
  const width = clampPct(value, max)
  return (
    <div className={muted ? 'bd-risk is-muted' : 'bd-risk'}>
      <div className="bd-risk-top">
        <strong>{title}</strong>
        {badge && <span className="bd-risk-badge">{badge}</span>}
        <b className="bd-risk-score">{display}</b>
      </div>
      <div className="bd-risk-track">
        <i style={{ '--bd-w': `${width.toFixed(1)}%`, background: color } as CSSProperties} />
      </div>
      <div className="bd-risk-meta">{meta}</div>
    </div>
  )
}

/* ---------- severity mix ---------- */

export function BoardSeverityMix({
  counts,
  total,
}: {
  counts: { level: RiskLevel; count: number }[]
  total: number
}) {
  return (
    <div className="bd-mix">
      <div className="bd-mix-track" aria-hidden="true">
        {counts.map((entry, i) =>
          entry.count > 0 ? (
            <i
              key={entry.level}
              title={`${levelLabel[entry.level]} · ${entry.count}`}
              style={
                {
                  width: `${(entry.count / Math.max(1, total)) * 100}%`,
                  background: levelColor[entry.level],
                  '--bd-i': i,
                } as CSSProperties
              }
            />
          ) : null,
        )}
        {total === 0 && <i className="is-empty" style={{ width: '100%' }} />}
      </div>
      <div className="bd-mix-legend">
        {counts.map((entry) => (
          <span key={entry.level}>
            <i style={{ background: levelColor[entry.level] }} />
            {levelLabel[entry.level]}
            <b>{entry.count}</b>
          </span>
        ))}
      </div>
    </div>
  )
}
