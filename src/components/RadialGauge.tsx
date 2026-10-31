import { useId, type ReactNode } from 'react'

export function RadialGauge({
  value,
  max = 100,
  size = 210,
  stroke = 8,
  color = '#e5545a',
  track = 'rgba(150,168,192,0.14)',
  children,
  ticks = 44,
  className,
}: {
  value: number
  max?: number
  size?: number
  stroke?: number
  color?: string
  track?: string
  children?: ReactNode
  ticks?: number
  className?: string
}) {
  const id = useId().replace(/:/g, '')
  const r = (size - stroke * 2 - 10) / 2
  const c = 2 * Math.PI * r
  const sweep = 0.75
  const arc = c * sweep
  const pct = Math.max(0, Math.min(1, value / max))
  const center = size / 2

  return (
    <div className={className} style={{ position: 'relative', width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <defs>
          <linearGradient id={`gauge-${id}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor={color} stopOpacity="0.65" />
            <stop offset="1" stopColor={color} />
          </linearGradient>
          <filter id={`glow-${id}`} x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        {Array.from({ length: ticks }, (_, i) => {
          const angle = 135 + (270 / (ticks - 1)) * i
          const major = i % 5 === 0
          const inner = r + stroke * 0.9
          const outer = r + stroke * 1.7 + (major ? 4 : 0)
          const rad = (angle * Math.PI) / 180
          const x1 = center + Math.cos(rad) * inner
          const y1 = center + Math.sin(rad) * inner
          const x2 = center + Math.cos(rad) * outer
          const y2 = center + Math.sin(rad) * outer
          return (
            <line
              key={i}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke={track}
              strokeWidth={major ? 1.2 : 0.8}
              opacity={major ? 0.9 : 0.55}
            />
          )
        })}
        <circle
          cx={center}
          cy={center}
          r={r}
          fill="none"
          stroke={track}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${arc} ${c}`}
          transform={`rotate(135 ${center} ${center})`}
        />
        <circle
          cx={center}
          cy={center}
          r={r}
          fill="none"
          stroke={`url(#gauge-${id})`}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${arc * pct} ${c}`}
          transform={`rotate(135 ${center} ${center})`}
          filter={`url(#glow-${id})`}
          style={{ transition: 'stroke-dasharray 1.2s cubic-bezier(.22,1,.36,1)' }}
        />
        <circle cx={center} cy={center} r={r - stroke * 1.9} fill="none" stroke={track} strokeWidth="0.5" opacity="0.5" />
      </svg>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          paddingTop: 10,
        }}
      >
        {children}
      </div>
    </div>
  )
}
