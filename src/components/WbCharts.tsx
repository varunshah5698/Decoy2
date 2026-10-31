import { useMemo, type CSSProperties, type ReactNode } from 'react'
import { Chart, axisStyle, chartFont, chartTokens } from './Chart'
import { useTheme } from '../lib/store'
import { AMBER, LEVEL_COLORS, SUPPRESSED, TEAL, hexA, levelColor } from '../lib/colors'
import { fmtDateShort, fmtScore } from '../lib/format'
import { cx } from '../lib/format'
import type { RiskLevel } from '../lib/types'

const DAYS = 86_400_000

/* ---------- risk dial ---------- */

export function RiskDial({
  value,
  level,
  suppressed,
  caption,
  height = 196,
}: {
  value: number
  level: RiskLevel
  suppressed: boolean
  caption: string
  height?: number
}) {
  const theme = useTheme((s) => s.theme)
  const option = useMemo(() => {
    const t = chartTokens(theme)
    const tone = suppressed ? SUPPRESSED : LEVEL_COLORS[level]
    return {
      tooltip: { show: false },
      series: [
        {
          type: 'gauge',
          min: 0,
          max: 100,
          startAngle: 206,
          endAngle: -26,
          radius: '94%',
          center: ['50%', '58%'],
          axisLine: {
            lineStyle: {
              width: 10,
              color: [
                [0.4, hexA(LEVEL_COLORS.LOW, 0.24)],
                [0.65, hexA(LEVEL_COLORS.MEDIUM, 0.24)],
                [0.85, hexA(LEVEL_COLORS.HIGH, 0.24)],
                [1, hexA(LEVEL_COLORS.CRITICAL, 0.26)],
              ],
            },
          },
          progress: {
            show: true,
            width: 10,
            roundCap: true,
            itemStyle: {
              color: tone,
              shadowColor: hexA(tone, t.dark ? 0.6 : 0.28),
              shadowBlur: t.dark ? 14 : 7,
            },
          },
          pointer: { length: '38%', width: 3, itemStyle: { color: tone } },
          anchor: { show: true, size: 8, itemStyle: { color: tone, borderColor: t.tooltipBg, borderWidth: 2 } },
          axisTick: { show: false },
          splitLine: { show: false },
          axisLabel: { show: false },
          title: { offsetCenter: [0, '31%'], color: t.muted, fontSize: 8.5, fontFamily: chartFont },
          detail: {
            offsetCenter: [0, '-11%'],
            formatter: (v: number) => fmtScore(v),
            color: tone,
            fontSize: 30,
            fontWeight: 600 as const,
            fontFamily: chartFont,
          },
          data: [{ value, name: caption }],
        },
      ],
    }
  }, [theme, value, level, suppressed, caption])

  return <Chart option={option} height={height} className="wb-dial" />
}

/* ---------- factor radar ---------- */

export type RadarSeries = { name: string; values: number[]; color: string; emphasis?: boolean }

export function FactorRadar({
  axes,
  series,
  height = 218,
}: {
  axes: string[]
  series: RadarSeries[]
  height?: number
}) {
  const theme = useTheme((s) => s.theme)
  const option = useMemo(() => {
    const t = chartTokens(theme)
    return {
      legend: {
        bottom: 0,
        itemWidth: 8,
        itemHeight: 8,
        textStyle: { color: t.muted, fontSize: 8.5, fontFamily: chartFont },
      },
      tooltip: {},
      radar: {
        indicator: axes.map((name) => ({ name })),
        radius: '62%',
        center: ['50%', '47%'],
        splitNumber: 4,
        axisName: { color: t.muted, fontSize: 8, fontFamily: chartFont },
        splitLine: { lineStyle: { color: theme === 'dark' ? 'rgba(150,168,192,.13)' : 'rgba(23,30,40,.11)' } },
        splitArea: {
          areaStyle: {
            color: [
              'transparent',
              theme === 'dark' ? 'rgba(255,255,255,.014)' : 'rgba(0,0,0,.014)',
            ],
          },
        },
        axisLine: { lineStyle: { color: theme === 'dark' ? 'rgba(150,168,192,.16)' : 'rgba(23,30,40,.13)' } },
      },
      series: [
        {
          type: 'radar',
          symbolSize: 4,
          data: series.map((entry) => ({
            name: entry.name,
            value: entry.values,
            lineStyle: {
              color: entry.color,
              width: entry.emphasis ? 2 : 1.2,
              type: entry.emphasis ? ('solid' as const) : ('dashed' as const),
            },
            itemStyle: { color: entry.color },
            areaStyle: { color: hexA(entry.color, entry.emphasis ? 0.2 : 0.07) },
          })),
        },
      ],
    }
  }, [theme, axes, series])

  return <Chart option={option} height={height} className="wb-radar" />
}

/* ---------- exploitability quadrant ---------- */

export type QuadrantPoint = {
  id: string
  cvss: number
  epss: number
  level: RiskLevel
  suppressed: boolean
  label: string
}

export function ExploitQuadrant({
  points,
  focusId,
  onPick,
  height = 236,
}: {
  points: QuadrantPoint[]
  focusId?: string | null
  onPick?: (id: string) => void
  height?: number
}) {
  const theme = useTheme((s) => s.theme)
  const context = points.filter((point) => point.id !== focusId)
  const focus = points.filter((point) => point.id === focusId)

  const option = useMemo(() => {
    const t = chartTokens(theme)
    const scatter = (rows: QuadrantPoint[], size: number) =>
      rows.map((row) => ({
        value: [row.cvss, row.epss * 100],
        name: row.label,
        id: row.id,
        itemStyle: {
          color: hexA(levelColor(row.level, row.suppressed), row.suppressed ? 0.42 : 0.82),
          borderColor: hexA(t.tooltipText, 0.35),
          borderWidth: 0.6,
        },
        symbolSize: size,
      }))

    return {
      grid: { left: 40, right: 26, top: 28, bottom: 40 },
      tooltip: {
        formatter: (params: { data?: { name?: string; value?: number[] } }) =>
          `${params.data?.name ?? ''}<br/>CVSS ${params.data?.value?.[0]?.toFixed(1)} · EPSS ${params.data?.value?.[1]?.toFixed(1)}%`,
      },
      xAxis: {
        type: 'value',
        min: 0,
        max: 10,
        name: 'CVSS severity',
        nameLocation: 'middle',
        nameGap: 24,
        ...axisStyle(theme),
      },
      yAxis: {
        type: 'value',
        min: 0,
        max: 100,
        name: 'EPSS %',
        ...axisStyle(theme),
      },
      series: [
        {
          name: 'Estate records',
          type: 'scatter',
          clip: false,
          data: scatter(context, 7),
          markLine: {
            silent: true,
            symbol: 'none',
            label: { position: 'insideEndTop', color: t.muted, fontSize: 8, fontFamily: chartFont },
            lineStyle: { color: t.line, type: 'dashed' as const, width: 1 },
            data: [
              { xAxis: 7, label: { formatter: 'CVSS 7.0' } },
              { yAxis: 50, label: { formatter: 'EPSS p50' } },
            ],
          },
          markArea: {
            silent: true,
            itemStyle: { color: hexA(LEVEL_COLORS.CRITICAL, 0.06) },
            data: [[{ xAxis: 7, yAxis: 50 }, { xAxis: 10, yAxis: 100 }]],
          },
        },
        {
          name: 'This record',
          type: 'scatter',
          clip: false,
          data: focus.map((row) => ({
            value: [row.cvss, row.epss * 100],
            name: row.label,
            id: row.id,
            symbolSize: 17,
            itemStyle: {
              color: hexA(levelColor(row.level, row.suppressed), 0.95),
              borderColor: AMBER,
              borderWidth: 2,
              shadowColor: hexA(AMBER, 0.55),
              shadowBlur: 12,
            },
          })),
          z: 6,
          label: {
            show: true,
            position: 'top',
            distance: 8,
            formatter: '{a|focus}',
            rich: { a: { color: AMBER, fontSize: 8, fontFamily: chartFont } },
          },
        },
      ],
    }
  }, [theme, context, focus])

  const onEvents = useMemo(
    () =>
      onPick
        ? {
            click: (params: unknown) => {
              const id = (params as { data?: { id?: string } }).data?.id
              if (id) onPick(id)
            },
          }
        : undefined,
    [onPick],
  )

  return <Chart option={option} height={height} onEvents={onEvents} className="wb-quadrant" />
}

/* ---------- score ladder ---------- */

export function ScoreLadder({
  rows,
  height = 200,
  onPick,
}: {
  rows: { label: string; sub?: string; value: number; color: string; id?: string }[]
  height?: number
  onPick?: (id: string) => void
}) {
  const theme = useTheme((s) => s.theme)
  const option = useMemo(() => {
    const t = chartTokens(theme)
    return {
      grid: { left: 8, right: 34, top: 8, bottom: 6, containLabel: true },
      tooltip: {
        formatter: (params: { name?: string; value?: number }) =>
          `${params.name}<br/>AEGIS score ${fmtScore(Number(params.value))}`,
      },
      xAxis: { type: 'value', min: 0, max: 100, ...axisStyle(theme) },
      yAxis: {
        type: 'category',
        data: rows.map((row) => row.label).reverse(),
        axisLine: { lineStyle: { color: t.line } },
        axisTick: { show: false },
        axisLabel: { color: t.text, fontSize: 9, fontFamily: chartFont },
        splitLine: { show: false },
      },
      series: [
        {
          type: 'bar',
          barWidth: '52%',
          data: rows
            .map((row) => ({
              value: row.value,
              id: row.id,
              itemStyle: { color: hexA(row.color, 0.86), borderRadius: [0, 3, 3, 0] },
            }))
            .reverse(),
          label: {
            show: true,
            position: 'right',
            color: t.text,
            fontSize: 9,
            fontFamily: chartFont,
            formatter: (params: { value?: number }) => fmtScore(Number(params.value)),
          },
        },
      ],
    }
  }, [theme, rows])

  const onEvents = useMemo(
    () =>
      onPick
        ? {
            click: (params: unknown) => {
              const id = (params as { data?: { id?: string } }).data?.id
              if (id) onPick(id)
            },
          }
        : undefined,
    [onPick],
  )

  return <Chart option={option} height={height} onEvents={onEvents} className="wb-ladder" />
}

/* ---------- relevance donut ---------- */

export function RelevanceDonut({
  slices,
  height = 190,
}: {
  slices: { label: string; value: number; color: string }[]
  height?: number
}) {
  const theme = useTheme((s) => s.theme)
  const total = slices.reduce((sum, slice) => sum + slice.value, 0)
  const option = useMemo(() => {
    const t = chartTokens(theme)
    return {
      legend: {
        bottom: 0,
        itemWidth: 8,
        itemHeight: 8,
        textStyle: { color: t.muted, fontSize: 8.5, fontFamily: chartFont },
      },
      tooltip: { formatter: '{b}: {c}' },
      graphic: {
        elements: [
          {
            type: 'text',
            left: 'center',
            top: '30%',
            style: { text: String(total), fill: t.text, fontSize: 22, fontFamily: chartFont, fontWeight: 600 },
          },
          {
            type: 'text',
            left: 'center',
            top: '43%',
            style: { text: 'EDGES', fill: t.muted, fontSize: 8, fontFamily: chartFont },
          },
        ],
      },
      series: [
        {
          type: 'pie',
          radius: ['56%', '76%'],
          center: ['50%', '41%'],
          avoidLabelOverlap: true,
          itemStyle: { borderColor: t.tooltipBg, borderWidth: 2 },
          label: { show: false },
          data: slices.map((slice) => ({
            name: slice.label,
            value: slice.value,
            itemStyle: { color: hexA(slice.color, 0.85) },
          })),
        },
      ],
    }
  }, [theme, slices, total])

  return <Chart option={option} height={height} className="wb-donut" />
}

/* ---------- CVSS vector bars ---------- */

const VECTOR_METRICS: { key: string; label: string; scale: Record<string, { weight: number; name: string }> }[] = [
  {
    key: 'AV',
    label: 'Attack vector',
    scale: { N: { weight: 1, name: 'Network' }, A: { weight: 0.72, name: 'Adjacent' }, L: { weight: 0.42, name: 'Local' }, P: { weight: 0.22, name: 'Physical' } },
  },
  {
    key: 'AC',
    label: 'Complexity',
    scale: { L: { weight: 1, name: 'Low' }, H: { weight: 0.55, name: 'High' } },
  },
  {
    key: 'PR',
    label: 'Privileges',
    scale: { N: { weight: 1, name: 'None' }, L: { weight: 0.62, name: 'Low' }, H: { weight: 0.3, name: 'High' } },
  },
  {
    key: 'UI',
    label: 'User interaction',
    scale: { N: { weight: 1, name: 'None' }, R: { weight: 0.7, name: 'Required' }, A: { weight: 0.45, name: 'Active' }, M: { weight: 0.45, name: 'Multiple' } },
  },
  {
    key: 'S',
    label: 'Scope',
    scale: { C: { weight: 1, name: 'Changed' }, U: { weight: 0.45, name: 'Unchanged' } },
  },
  { key: 'C', label: 'Confidentiality', scale: { H: { weight: 1, name: 'High' }, L: { weight: 0.55, name: 'Low' }, N: { weight: 0.04, name: 'None' } } },
  { key: 'I', label: 'Integrity', scale: { H: { weight: 1, name: 'High' }, L: { weight: 0.55, name: 'Low' }, N: { weight: 0.04, name: 'None' } } },
  { key: 'A', label: 'Availability', scale: { H: { weight: 1, name: 'High' }, L: { weight: 0.55, name: 'Low' }, N: { weight: 0.04, name: 'None' } } },
]

export const vectorMetrics = (vector: string) => {
  const parts = new Map(
    vector
      .split('/')
      .filter((part) => part.includes(':') && !part.startsWith('CVSS'))
      .map((part) => {
        const [key, value] = part.split(':')
        return [key, value] as const
      }),
  )
  return VECTOR_METRICS.map((metric) => {
    const code = parts.get(metric.key) ?? ''
    const entry = metric.scale[code]
    return {
      key: metric.key,
      label: metric.label,
      code,
      name: entry?.name ?? 'Unknown',
      weight: entry?.weight ?? 0.04,
    }
  })
}

export function VectorBars({ vector }: { vector: string }) {
  const metrics = useMemo(() => vectorMetrics(vector), [vector])
  return (
    <div className="wb-vector">
      {metrics.map((metric) => (
        <div className="wb-vector-row" key={metric.key}>
          <span className="wb-vector-key mono">{metric.key}</span>
          <span className="wb-vector-label">{metric.label}</span>
          <span className="wb-vector-track" aria-hidden="true">
            <i style={{ width: `${Math.max(4, metric.weight * 100)}%` }} />
          </span>
          <span className="wb-vector-value">
            {metric.name}
            <em className="mono">{metric.code}</em>
          </span>
        </div>
      ))}
    </div>
  )
}

/* ---------- intel timeline ---------- */

export type TimelineEvent = { at: string; label: string; tone: string; note?: string }

export function IntelTimeline({ events, now }: { events: TimelineEvent[]; now: Date }) {
  const marks = useMemo(() => {
    const rows = [
      ...events.map((event) => ({ ...event, time: new Date(event.at).getTime(), isNow: false })),
      { at: now.toISOString(), label: 'today', tone: TEAL, time: now.getTime(), isNow: true, note: undefined },
    ]
      .filter((row) => Number.isFinite(row.time))
      .sort((a, b) => a.time - b.time)
    if (!rows.length) return []
    const min = rows[0].time
    const max = rows[rows.length - 1].time
    const span = Math.max(1, max - min)
    const last = rows.length - 1
    // Pure time position lets one ancient event squash everything recent into a
    // few pixels, so blend it with even rank spacing to keep the axis legible.
    const positioned = rows.map((row, index) => {
      const timeX = ((row.time - min) / span) * 100
      const rankX = last === 0 ? 100 : (index / last) * 100
      return { ...row, x: timeX * 0.55 + rankX * 0.45 }
    })
    const lanes = 2
    const gap = last === 0 ? 100 : (100 / last) * 0.45
    let prevX = -100
    let lane = 0
    return positioned.map((row) => {
      lane = row.x - prevX > Math.max(13, gap * 1.15) ? 0 : (lane + 1) % lanes
      prevX = row.x
      return { ...row, lane, align: row.x < 12 ? 'start' : row.x > 88 ? 'end' : 'center' }
    })
  }, [events, now])

  if (!marks.length) return null
  const first = marks[0]
  const last = marks[marks.length - 1]
  const spanDays = Math.max(1, Math.round((last.time - first.time) / DAYS))

  return (
    <div className="wb-timeline">
      <div className="wb-timeline-axis">
        <span className="wb-timeline-fill" style={{ width: `${last.x}%` }} />
        {marks.map((mark) => (
          <span
            key={`${mark.at}-${mark.label}`}
            className={cx('wb-timeline-mark', mark.isNow && 'is-now')}
            style={{ left: `${mark.x}%`, '--lane': mark.lane, '--tone': mark.tone } as CSSProperties}
          >
            <i />
            <span className={cx('wb-timeline-text', mark.align !== 'center' && `align-${mark.align}`)}>
              <strong>{mark.label}</strong>
              <em>{fmtDateShort(mark.at)}</em>
            </span>
          </span>
        ))}
      </div>
      <div className="wb-timeline-foot mono">
        <span>{fmtDateShort(first.at)}</span>
        <span>{spanDays.toLocaleString()}d span · recency-weighted</span>
        <span>{fmtDateShort(last.at)}</span>
      </div>
    </div>
  )
}

/* ---------- ego network ---------- */

export type EgoNode = {
  id: string
  label: string
  sub?: string
  value: number
  level: RiskLevel
  suppressed: boolean
  /** A platform that shares an installed build rather than a correlation path. */
  peer?: boolean
}

export function EgoGraph({
  center,
  nodes,
  onSelect,
}: {
  center: { label: string; sub: string; level: RiskLevel; suppressed: boolean }
  nodes: EgoNode[]
  onSelect: (id: string) => void
}) {
  const size = 300
  const radius = 108
  const cx0 = size / 2
  const cy0 = size / 2 - 4
  const tone = levelColor(center.level, center.suppressed)
  const dark = useTheme((s) => s.theme) === 'dark'

  return (
    <div className="wb-ego">
      <svg viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`Neighbourhood graph for ${center.label}`}>
        <defs>
          <radialGradient id="wb-ego-core" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={hexA(tone, dark ? 0.5 : 0.15)} />
            <stop offset="100%" stopColor={hexA(tone, 0)} />
          </radialGradient>
        </defs>
        <circle cx={cx0} cy={cy0} r={radius} className="wb-ego-ring" />
        <circle cx={cx0} cy={cy0} r={radius * 0.62} className="wb-ego-ring" />
        <circle cx={cx0} cy={cy0} r={radius * 1.05} fill="url(#wb-ego-core)" />
        {nodes.map((node, index) => {
          const angle = (-90 + (360 / Math.max(1, nodes.length)) * index) * (Math.PI / 180)
          const x = cx0 + Math.cos(angle) * radius
          const y = cy0 + Math.sin(angle) * radius
          const color = node.peer ? '#8b98ad' : levelColor(node.level, node.suppressed)
          const gated = node.peer || node.suppressed
          return (
            <g key={`${node.id}-${node.peer ? 'peer' : 'path'}`}>
              <line
                x1={cx0}
                y1={cy0}
                x2={x}
                y2={y}
                stroke={color}
                strokeWidth={gated ? 0.9 : 1.5}
                strokeOpacity={gated ? 0.32 : 0.75}
                strokeDasharray={gated ? '3 4' : undefined}
                className={gated ? undefined : 'wb-ego-edge'}
              />
              <circle
                cx={x}
                cy={y}
                r={gated ? 5 : 7}
                fill={node.peer ? (dark ? '#141a24' : '#fff') : hexA(color, 0.22)}
                stroke={color}
                strokeWidth="1.4"
              />
              <text x={x} y={y - 12} textAnchor="middle" className="wb-ego-label">
                {node.label.length > 16 ? `${node.label.slice(0, 15)}…` : node.label}
              </text>
              <text x={x} y={y + 20} textAnchor="middle" className="wb-ego-value" fill={color}>
                {node.peer ? node.sub ?? '' : fmtScore(node.value)}
              </text>
              <circle
                cx={x}
                cy={y}
                r={16}
                fill="transparent"
                className="wb-ego-hit"
                role="button"
                tabIndex={0}
                aria-label={
                  node.peer ? `${node.label}, shares ${node.sub ?? 'a build'}` : `${node.label}, score ${fmtScore(node.value)}`
                }
                onClick={() => onSelect(node.id)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    onSelect(node.id)
                  }
                }}
              />
            </g>
          )
        })}
        <circle cx={cx0} cy={cy0} r={26} fill={hexA(tone, 0.16)} stroke={tone} strokeWidth="1.6" />
        <text x={cx0} y={cy0 + 4} textAnchor="middle" className="wb-ego-center">
          {center.label.length > 12 ? `${center.label.slice(0, 11)}…` : center.label}
        </text>
      </svg>
      <div className="wb-ego-legend mono">
        <span>{center.sub}</span>
        <span>
          {nodes.filter((n) => !n.peer).length} paths · {nodes.filter((n) => n.peer).length} stack peers
        </span>
      </div>
    </div>
  )
}

/* ---------- gate comparison ---------- */

export function GateCompare({
  rows,
  height = 208,
}: {
  rows: { label: string; aegis: number; cvssOnly: number; suppressed: boolean }[]
  height?: number
}) {
  const theme = useTheme((s) => s.theme)
  const option = useMemo(() => {
    const t = chartTokens(theme)
    return {
      legend: {
        top: 0,
        itemWidth: 8,
        itemHeight: 8,
        textStyle: { color: t.muted, fontSize: 8.5, fontFamily: chartFont },
      },
      grid: { left: 8, right: 12, top: 26, bottom: 4, containLabel: true },
      tooltip: { axisPointer: { type: 'shadow' } },
      xAxis: {
        type: 'category',
        data: rows.map((row) => row.label),
        axisLine: { lineStyle: { color: t.line } },
        axisTick: { show: false },
        axisLabel: { color: t.muted, fontSize: 8.5, fontFamily: chartFont, interval: 0, rotate: rows.length > 4 ? 26 : 0 },
        splitLine: { show: false },
      },
      yAxis: { type: 'value', min: 0, max: 100, ...axisStyle(theme) },
      series: [
        {
          name: 'AEGIS gated',
          type: 'bar',
          barMaxWidth: 26,
          itemStyle: { color: TEAL, borderRadius: [3, 3, 0, 0] },
          data: rows.map((row) => ({
            value: row.aegis,
            itemStyle: { color: row.suppressed ? SUPPRESSED : TEAL, borderRadius: [3, 3, 0, 0] },
          })),
        },
        {
          name: 'CVSS-only rank',
          type: 'bar',
          barMaxWidth: 26,
          itemStyle: { color: hexA(AMBER, 0.5), borderRadius: [3, 3, 0, 0] },
          data: rows.map((row) => ({
            value: row.cvssOnly,
            itemStyle: { color: hexA(AMBER, 0.42), borderRadius: [3, 3, 0, 0] },
          })),
        },
      ],
    }
  }, [theme, rows])

  return <Chart option={option} height={height} className="wb-gate" />
}

/* ---------- SLA ladder ---------- */

export type SlaRow = {
  id: string
  label: string
  sub: string
  elapsedDays: number
  windowDays: number
  remainingDays: number
  level: RiskLevel
  suppressed: boolean
}

export function SlaLadder({ rows, onPick }: { rows: SlaRow[]; onPick?: (id: string) => void }) {
  const windows = rows.map((row) => row.windowDays)
  const lo = Math.min(...windows)
  const hi = Math.max(...windows)
  const over = rows.filter((row) => row.remainingDays < 0).length
  const duration = (days: number) => {
    const d = Math.round(Math.abs(days))
    if (d >= 730) return `${(d / 365).toFixed(1)}y`
    if (d >= 60) return `${Math.round(d / 30)}mo`
    return `${d}d`
  }
  return (
    <div className="wb-sla">
      {rows.map((row) => {
        const pct = (row.elapsedDays / Math.max(1, row.windowDays)) * 100
        const remaining = Math.round(row.remainingDays)
        const tone = levelColor(row.level, row.suppressed)
        const body = (
          <>
            <span className="wb-sla-label">
              <strong>{row.label}</strong>
              <span className="mono">{row.sub}</span>
            </span>
            <span className="wb-sla-track">
              <i style={{ width: `${Math.max(3, Math.min(100, pct))}%`, background: tone }} />
            </span>
            <span className={cx('wb-sla-state', remaining < 0 ? 'over' : remaining <= 3 ? 'warn' : 'ok')}>
              {remaining < 0 ? `${duration(remaining)} overdue` : `${duration(remaining)} left`}
            </span>
          </>
        )
        return onPick ? (
          <button key={row.id} className="wb-sla-row" onClick={() => onPick(row.id)}>
            {body}
          </button>
        ) : (
          <div className="wb-sla-row" key={row.id}>
            {body}
          </div>
        )
      })}
      <div className="wb-sla-legend mono">
        <span>bar = exposure age against the patch window</span>
        <span>
          {rows.length
            ? `${over > 0 ? `${over} past due · ` : ''}windows ${lo === hi ? `${lo}d` : `${lo}–${hi}d`}`
            : 'no open paths'}
        </span>
      </div>
    </div>
  )
}

/* ---------- analysis band shell ---------- */

export function ChartCard({
  title,
  sub,
  action,
  children,
  className,
}: {
  title: string
  sub?: string
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section className={cx('wb-chart-card', className)}>
      <header className="wb-chart-head">
        <div>
          <h4>{title}</h4>
          {sub && <p>{sub}</p>}
        </div>
        {action}
      </header>
      <div className="wb-chart-body">{children}</div>
    </section>
  )
}
