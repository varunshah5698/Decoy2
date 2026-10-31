import { useId } from 'react'

export function Sparkline({
  values,
  width = 64,
  height = 24,
  color = '#3ed2c1',
  fill = true,
  strokeWidth = 1.4,
  dot = false,
  delay = 0,
  fluid = false,
}: {
  values: number[]
  width?: number
  height?: number
  color?: string
  fill?: boolean
  strokeWidth?: number
  dot?: boolean
  delay?: number
  fluid?: boolean
}) {
  const id = useId().replace(/:/g, '')
  if (!values.length) return null
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1 || 1)) * (width - 2) + 1
    const y = height - 2 - ((v - min) / span) * (height - 5)
    return [x, y] as const
  })
  const line = pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
  const area = `${line} L${width - 1},${height} L1,${height} Z`
  const last = pts[pts.length - 1]

  return (
    <svg
      width={fluid ? '100%' : width}
      height={fluid ? '100%' : height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio={fluid ? 'none' : 'xMidYMid meet'}
      fill="none"
      aria-hidden="true"
    >
      {fill && (
        <>
          <defs>
            <linearGradient id={`spark-${id}`} x1="0" y1="0" x2="0" y2="1">
              <stop stopColor={color} stopOpacity="0.3" />
              <stop offset="1" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path className="spark-area" d={area} fill={`url(#spark-${id})`} style={{ animationDelay: `${delay + 240}ms` }} />
        </>
      )}
      <path
        className="spark-line"
        d={line}
        pathLength={1}
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect={fluid ? 'non-scaling-stroke' : undefined}
        style={{ animationDelay: `${delay}ms` }}
      />
      {dot && !fluid && (
        <circle className="spark-end" cx={last[0]} cy={last[1]} r={2} fill={color} style={{ animationDelay: `${delay + 1000}ms` }} />
      )}
    </svg>
  )
}
