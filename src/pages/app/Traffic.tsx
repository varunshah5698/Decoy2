import { useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { Chart } from '../../components/Chart'
import { Drawer, DrawerHead } from '../../components/Drawer'
import {
  Activity,
  ArrowRight,
  BarChart3,
  Gauge,
  Grid3X3,
  Info,
  Layers,
  TrendingUp,
  Zap,
} from '../../components/Icons'
import { trafficSeries } from '../../data/seed'
import { useTheme } from '../../lib/store'
import { cx, fmtInt } from '../../lib/format'
import { mean, p95, quantile, stdev } from '../../lib/stats'
import type { TrafficPoint } from '../../lib/types'
import './traffic.css'

const MONO = "'JetBrains Mono Variable', ui-monospace, monospace"
const DISPLAY = "'Space Grotesk Variable', 'Inter Variable', system-ui, sans-serif"
const BUCKET_SECONDS = 1800

type Metric = 'rps' | 'bytes' | 'failed'

const METRICS: { id: Metric; label: string; unit: string; peakLabel: string }[] = [
  { id: 'rps', label: 'Requests', unit: 'req / second', peakLabel: 'peak throughput' },
  { id: 'bytes', label: 'Bytes', unit: 'MB per bucket', peakLabel: 'peak volume' },
  { id: 'failed', label: 'Failures', unit: 'auth failures', peakLabel: 'peak failures' },
]

const metricValue = (t: TrafficPoint, metric: Metric) =>
  metric === 'rps' ? t.rps : metric === 'bytes' ? t.bytes / 1e6 : t.failed

const fmtMetric = (metric: Metric, value: number) =>
  metric === 'bytes' ? value.toFixed(1) : String(Math.round(value))

const rps = trafficSeries.map((t) => t.rps)
const avg = mean(rps)
const sigma = stdev(rps)
const threshold = avg + 2 * sigma
const peak = Math.max(...rps)
const zOf = (t: TrafficPoint) => (t.rps - avg) / sigma
const bursts = trafficSeries.filter((t) => zOf(t) >= 2)
const elevated = trafficSeries.filter((t) => zOf(t) >= 1 && zOf(t) < 2)
const quiet = trafficSeries.filter((t) => zOf(t) < 1)
const totalBytes = trafficSeries.reduce((a, t) => a + t.bytes, 0)
const totalFailed = trafficSeries.reduce((a, t) => a + t.failed, 0)
const totalRequests = rps.reduce((a, b) => a + b, 0) * BUCKET_SECONDS
const flagRate = bursts.length / trafficSeries.length
const burstRequests = bursts.reduce((a, t) => a + t.rps, 0) * BUCKET_SECONDS
const burstBytes = bursts.reduce((a, t) => a + t.bytes, 0)
const burstFailed = bursts.reduce((a, t) => a + t.failed, 0)
const burstLoad = mean(bursts.map((t) => t.rps))
const baselineLoad = mean(
  trafficSeries.filter((t) => zOf(t) < 2).map((t) => t.rps),
)
const compareMax = Math.max(burstLoad, baselineLoad)
const maxRps = peak
const maxBytes = Math.max(...trafficSeries.map((t) => t.bytes))
const maxFailed = Math.max(...trafficSeries.map((t) => t.failed))

const zRows = bursts.map((t) => ({ ...t, z: zOf(t) })).sort((a, b) => b.z - a.z)

const zBins = [-3, -2, -1, 0, 1, 2, 3].map((lo, i) => {
  const first = i === 0
  const last = i === 6
  const members = trafficSeries.filter((t) => {
    const z = zOf(t)
    if (first) return z < lo + 1
    if (last) return z >= lo
    return z >= lo && z < lo + 1
  })
  const loads = members.map((t) => t.rps)
  return {
    lo,
    hi: lo + 1,
    first,
    last,
    label: `${lo > 0 ? '+' : ''}${lo}σ`,
    count: members.length,
    members,
    minRps: loads.length ? Math.min(...loads) : 0,
    maxRps: loads.length ? Math.max(...loads) : 0,
    densest: [...members].sort((a, b) => b.rps - a.rps).slice(0, 3),
  }
})
const maxBin = Math.max(...zBins.map((b) => b.count))

const binRange = (b: (typeof zBins)[number]) => {
  const edge = (v: number) => `${v > 0 ? '+' : ''}${v}σ`
  if (b.first) return `below ${edge(b.hi)}`
  if (b.last) return `at or above ${edge(b.lo)}`
  return `${edge(b.lo)} to ${edge(b.hi)}`
}

const bandLoad = (b: (typeof zBins)[number]) => {
  if (!b.count) return '—'
  const lo = Math.round(b.minRps)
  const hi = Math.round(b.maxRps)
  return lo === hi ? `${lo} req/s` : `${lo} – ${hi} req/s`
}

const inSpreadWindow = (k: number) => trafficSeries.filter((t) => Math.abs(zOf(t)) <= k).length

const PERIODS = Array.from({ length: 12 }, (_, i) => {
  const slice = trafficSeries.slice(i * 4, i * 4 + 4)
  const load = slice.reduce((a, t) => a + t.rps, 0)
  const burstLoadSum = slice.filter((t) => zOf(t) >= 2).reduce((a, t) => a + t.rps, 0)
  return {
    hour: slice[0].time.slice(0, 2),
    load,
    burstShare: load ? burstLoadSum / load : 0,
    flagged: slice.some((t) => zOf(t) >= 2),
  }
})
const maxPeriod = Math.max(...PERIODS.map((p) => p.load))
const busiest = PERIODS.reduce((a, b) => (b.load > a.load ? b : a))
const busiestShare = busiest.load / PERIODS.reduce((a, p) => a + p.load, 0)
const busiestRequests = busiest.load * BUCKET_SECONDS

const blockCount = (value: number, max: number) => Math.max(1, Math.round((value / max) * 10))

const ladder = [
  { label: 'median', value: quantile(rps, 0.5) },
  { label: 'p90', value: quantile(rps, 0.9) },
  { label: 'p95', value: p95(rps) },
  { label: 'max', value: peak },
]

function GaugeArc({ segments, total }: { segments: { count: number; color: string }[]; total: number }) {
  const size = 268
  const stroke = 26
  const center = size / 2
  const radius = (size - stroke) / 2 - 2
  const circum = 2 * Math.PI * radius
  const sweep = 270
  const gap = 7
  let travelled = 0

  const ticks = Array.from({ length: 41 }, (_, i) => {
    const angle = 135 + (sweep / 40) * i
    const rad = (angle * Math.PI) / 180
    const inner = radius - stroke * 1.55
    const outer = radius - stroke * 1.05
    return (
      <line
        key={i}
        x1={center + Math.cos(rad) * inner}
        y1={center + Math.sin(rad) * inner}
        x2={center + Math.cos(rad) * outer}
        y2={center + Math.sin(rad) * outer}
        stroke="var(--tf-line)"
        strokeWidth={i % 5 === 0 ? 1.4 : 0.9}
      />
    )
  })

  return (
    <svg viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${bursts.length} of ${total} buckets above the burst line`}>
      <circle
        cx={center}
        cy={center}
        r={radius}
        fill="none"
        stroke="var(--tf-track)"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={`${(circum * sweep) / 360} ${circum}`}
        transform={`rotate(135 ${center} ${center})`}
      />
      {segments.map((segment) => {
        const degrees = (segment.count / total) * sweep
        const length = (circum * degrees) / 360
        const rotation = 135 + travelled + ((gap / circum) * 360) / 2
        travelled += degrees
        return (
          <circle
            key={segment.color}
            className="tf-gauge-seg"
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            stroke={segment.color}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${Math.max(length - gap, 1)} ${circum}`}
            transform={`rotate(${rotation} ${center} ${center})`}
          />
        )
      })}
      <circle
        cx={center}
        cy={center}
        r={radius - stroke * 0.72}
        fill="none"
        stroke="var(--tf-line-2)"
        strokeWidth={1}
        strokeDasharray={`${(circum * sweep) / 360} ${circum}`}
        transform={`rotate(135 ${center} ${center})`}
      />
      <circle cx={center} cy={center} r={radius - stroke * 1.55} fill="none" stroke="var(--tf-line)" strokeWidth={0.6} />
    </svg>
  )
}

function CardHead({
  icon,
  tone,
  title,
  sub,
  action,
}: {
  icon: ReactNode
  tone?: string
  title: string
  sub: string
  action?: ReactNode
}) {
  return (
    <div className="tf-card-head">
      <div className="tf-titlewrap">
        <span className={cx('tf-card-icon', tone)}>{icon}</span>
        <div>
          <h2 className="tf-card-title">{title}</h2>
          <div className="tf-card-sub">{sub}</div>
        </div>
      </div>
      {action}
    </div>
  )
}

export default function Traffic() {
  const theme = useTheme((s) => s.theme)
  const [selected, setSelected] = useState<TrafficPoint | null>(null)
  const [onlyBursts, setOnlyBursts] = useState(false)
  const [metric, setMetric] = useState<Metric>('rps')
  const [pinnedBin, setPinnedBin] = useState<number | null>(null)
  const [peekedBin, setPeekedBin] = useState<number | null>(null)
  const [spreadK, setSpreadK] = useState(2)

  const dark = theme === 'dark'
  const accent = dark ? '#ff6a36' : '#ff5a1f'
  const navy = dark ? '#c9d8ea' : '#14263e'
  const axisColor = dark ? '#6f849a' : '#a8a29a'
  const gridColor = dark ? 'rgba(255,255,255,0.06)' : 'rgba(16,29,45,0.07)'
  const cardColor = dark ? '#121f2c' : '#fffdf9'

  const meta = METRICS.find((m) => m.id === metric)!
  const series = useMemo(() => trafficSeries.map((t) => metricValue(t, metric)), [metric])
  const seriesAvg = mean(series)
  const seriesSigma = stdev(series)
  const seriesThreshold = seriesAvg + 2 * seriesSigma
  const seriesPeak = Math.max(...series)
  const peakIndex = series.indexOf(seriesPeak)
  const peakBucketRow = trafficSeries[peakIndex]

  const chartOption = useMemo(() => {
    const lineColor = metric === 'failed' ? (dark ? '#8fa3b8' : '#8d99a8') : metric === 'bytes' ? navy : accent
    const areaTop = metric === 'rps' ? accent : lineColor

    const featureBar = (label: string, value: number, max: number, color: string) =>
      `<div style="display:grid;grid-template-columns:76px 40px minmax(0,1fr);align-items:center;gap:7px;font:500 8.5px ${MONO};color:#8fa3b8">
        <span style="letter-spacing:.02em">${label}</span>
        <span style="color:#e9f0f8;text-align:right">${value}</span>
        <span style="display:block;height:4px;border-radius:99px;background:rgba(255,255,255,.09)">
          <span style="display:block;height:100%;width:${Math.round((value / max) * 100)}%;border-radius:99px;background:${color}"></span>
        </span>
      </div>`

    const burstAreas: [{ xAxis: string }, { xAxis: string }][] = []
    let runStart = -1
    trafficSeries.forEach((t, i) => {
      const isBurst = zOf(t) >= 2
      if (isBurst && runStart === -1) runStart = i
      const last = i === trafficSeries.length - 1
      if (runStart !== -1 && (!isBurst || last)) {
        burstAreas.push([
          { xAxis: trafficSeries[runStart].time },
          { xAxis: trafficSeries[isBurst ? i : i - 1].time },
        ])
        runStart = -1
      }
    })

    return {
      animationDuration: 900,
      grid: { left: 48, right: 18, top: 30, bottom: 30 },
      xAxis: {
        type: 'category',
        boundaryGap: false,
        data: trafficSeries.map((t) => t.time),
        axisLine: { lineStyle: { color: gridColor } },
        axisTick: { show: false },
        axisLabel: {
          color: axisColor,
          fontSize: 8.5,
          fontFamily: MONO,
          interval: 7,
          margin: 12,
        },
      },
      yAxis: {
        type: 'value',
        splitNumber: 3,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: {
          color: axisColor,
          fontSize: 8.5,
          fontFamily: MONO,
          formatter: (value: number) => (metric === 'bytes' ? `${Math.round(value)}M` : String(Math.round(value))),
        },
        splitLine: { lineStyle: { color: gridColor, type: 'dashed' } },
      },
      tooltip: {
        trigger: 'axis',
        backgroundColor: 'rgba(10,17,27,0.97)',
        borderWidth: 0,
        padding: [12, 14],
        extraCssText: 'border-radius:16px;box-shadow:0 24px 50px -20px rgba(0,0,0,.65);',
        axisPointer: { type: 'line', lineStyle: { color: accent, width: 1, type: 'dashed' } },
        formatter: (params: any) => {
          const index = params?.[0]?.dataIndex ?? 0
          const t = trafficSeries[index]
          const value = metricValue(t, metric)
          const isBurst = zOf(t) >= 2
          const prev = index > 0 ? metricValue(trafficSeries[index - 1], metric) : null
          const delta = prev == null ? null : value - prev
          return `<div style="min-width:212px">
            <div style="display:flex;justify-content:space-between;gap:18px;font:500 8.5px ${MONO};letter-spacing:.12em;text-transform:uppercase;color:#7d8ea3">
              <span>${t.time} bucket</span>
              <span style="color:${isBurst ? '#ff9b74' : '#7fe0d2'}">${isBurst ? 'Burst' : 'Baseline'}</span>
            </div>
            <div style="display:flex;align-items:baseline;gap:7px;margin-top:9px">
              <span style="font:600 26px/1 ${DISPLAY};letter-spacing:-.045em;color:#f4f8fc">${fmtMetric(metric, value)}</span>
              <span style="font:500 8.5px ${MONO};color:#8fa3b8">${meta.unit}</span>
              ${delta == null ? '' : `<span style="margin-left:auto;font:500 8.5px ${MONO};color:${delta > 0 ? '#ff9b74' : '#7fe0d2'}">${delta > 0 ? '+' : ''}${fmtMetric(metric, delta)}</span>`}
            </div>
            <div style="margin-top:11px;display:grid;gap:5px">
              ${featureBar('Requests /s', t.rps, maxRps, '#ff7a45')}
              ${featureBar('Volume MB', Math.round(t.bytes / 1e6), Math.round(maxBytes / 1e6), '#c9d8ea')}
              ${featureBar('Failures', t.failed, maxFailed, '#7f93a9')}
            </div>
          </div>`
        },
      },
      series: [
        {
          type: 'line',
          data: series,
          smooth: 0.32,
          symbol: 'circle',
          symbolSize: 8,
          showSymbol: false,
          lineStyle: { width: 2.4, color: lineColor, cap: 'round' },
          itemStyle: { color: lineColor, borderColor: cardColor, borderWidth: 2 },
          emphasis: { scale: 1.4, itemStyle: { color: lineColor } },
          areaStyle: {
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: `${areaTop}${dark ? '4f' : '55'}` },
                { offset: 0.72, color: `${areaTop}${dark ? '0d' : '10'}` },
                { offset: 1, color: `${areaTop}00` },
              ],
            },
          },
          markArea: {
            silent: true,
            itemStyle: { color: dark ? 'rgba(255,106,54,0.07)' : 'rgba(255,90,31,0.06)' },
            data: burstAreas as any,
          },
          markLine: {
            silent: true,
            symbol: 'none',
            lineStyle: { color: '#e08a2f', type: 'dashed', width: 1, opacity: 0.75 },
            label: {
              formatter: `μ+2σ = ${metric === 'bytes' ? seriesThreshold.toFixed(1) : Math.round(seriesThreshold)}`,
              color: dark ? '#e0a955' : '#b4701f',
              fontSize: 8,
              fontFamily: MONO,
              position: 'insideEndTop',
            },
            data: [{ yAxis: seriesThreshold }],
          },
          markPoint: {
            symbol: 'circle',
            symbolSize: 7,
            itemStyle: { color: lineColor, borderColor: cardColor, borderWidth: 2 },
            label: { show: false },
            data: trafficSeries
              .map((t, index) => ({ burst: zOf(t) >= 2, index }))
              .filter((d) => d.burst)
              .map((d) => ({ coord: [d.index, series[d.index]] })),
          },
        },
      ],
    }
  }, [metric, dark, accent, navy, axisColor, gridColor, cardColor, meta, series, seriesThreshold])

  const scrollToRegister = () => document.getElementById('tf-register')?.scrollIntoView({ behavior: 'smooth', block: 'start' })

  const activeBinIndex = peekedBin ?? pinnedBin
  const activeBin = activeBinIndex === null ? null : zBins[activeBinIndex]
  const pinned = pinnedBin === null ? null : zBins[pinnedBin]
  const windowCount = inSpreadWindow(spreadK)
  const windowPct = windowCount / trafficSeries.length
  const spreadPct = ((spreadK - 0.5) / 2.5) * 100

  const stepBin = (from: number, delta: number) => {
    const next = Math.min(zBins.length - 1, Math.max(0, from + delta))
    setPeekedBin(next)
    document.querySelectorAll<HTMLButtonElement>('.tf-dev-row')[next]?.focus()
  }

  const toggleBin = (index: number) => {
    setPinnedBin((current) => (current === index ? null : index))
  }

  const rows = onlyBursts ? bursts : trafficSeries

  const shares = [
    { label: 'Requests', pct: burstRequests / totalRequests, value: `${(burstRequests / 1e6).toFixed(2)}M of ${(totalRequests / 1e6).toFixed(1)}M`, tone: '' },
    { label: 'Bytes served', pct: burstBytes / totalBytes, value: `${(burstBytes / 1e9).toFixed(2)}GB of ${(totalBytes / 1e9).toFixed(2)}GB`, tone: 'navy' },
    { label: 'Auth failures', pct: burstFailed / totalFailed, value: `${burstFailed} of ${totalFailed}`, tone: 'slate' },
  ]

  const stats = [
    { name: 'Mean RPS', value: avg.toFixed(1), formula: 'mean(rps_i)' },
    { name: 'Std deviation', value: sigma.toFixed(1), formula: 'sample σ, n−1' },
    { name: 'p95 RPS', value: p95(rps).toFixed(0), formula: '95th percentile' },
    { name: 'Peak z-score', value: ((peak - avg) / sigma).toFixed(2), formula: '(peak − μ) ÷ σ' },
    { name: 'Flag rate', value: `${(flagRate * 100).toFixed(1)}%`, formula: 'μ+2σ ÷ all buckets' },
  ]

  return (
    <div className="traffic-page">
      <div className="tf-shell">
        <header className="tf-head">
          <div className="tf-head-copy">
            <span className="tf-eyebrow">Component 15 · Traffic analytics</span>
            <h1>
              Volume, bursts, and <em>the tail</em>
            </h1>
            <p>
              Forty-eight half-hour buckets of edge traffic. Bursts are detected with a simple μ+2σ rule — a
              transparent baseline, not a black box.
            </p>
          </div>
          <div className="tf-head-side">
            <div className="tf-pillrow">
              <span className="tf-pill">
                <span className="tf-dot" />
                Edge log · {trafficSeries.length} buckets
              </span>
              <span className="tf-pill ghost">Simulated demo</span>
            </div>
            <button className="tf-btn dark" onClick={scrollToRegister}>
              Bucket register <ArrowRight size={13} />
            </button>
          </div>
        </header>

        <div className="tf-grid">
          <section className="tf-card tf-gauge-card">
            <CardHead
              icon={<Gauge size={16} />}
              title="Burst exposure"
              sub="48 buckets across the demo day"
              action={
                <button className="tf-icon-btn" aria-label="About the gauge" onClick={scrollToRegister}>
                  <Info size={13} />
                </button>
              }
            />
            <div className="tf-gauge-body">
              <div className="tf-gauge-ring">
                <GaugeArc
                  total={trafficSeries.length}
                  segments={[
                    { count: bursts.length, color: 'var(--tf-orange)' },
                    { count: elevated.length, color: 'var(--tf-watch)' },
                    { count: quiet.length, color: 'var(--tf-slate-2)' },
                  ]}
                />
                <div className="tf-gauge-center">
                  <div className="tf-gauge-value">
                    {avg.toFixed(0)}
                    <small>req/s</small>
                  </div>
                  <div className="tf-gauge-label">mean throughput</div>
                </div>
              </div>
              <div className="tf-gauge-legend">
                <span>
                  <i style={{ background: 'var(--tf-orange)' }} /> Burst {bursts.length}
                </span>
                <span>
                  <i style={{ background: 'var(--tf-watch)' }} /> Elevated {elevated.length}
                </span>
                <span>
                  <i style={{ background: 'var(--tf-slate-2)' }} /> Baseline {quiet.length}
                </span>
              </div>
              <div className="tf-split-stats">
                <div className="tf-split-stat">
                  <Zap size={13} />
                  <b>{fmtInt(peak)}</b>
                  <span>peak req/s</span>
                </div>
                <div className="tf-split-stat">
                  <Activity size={13} />
                  <b>{threshold.toFixed(0)}</b>
                  <span>μ+2σ line</span>
                </div>
                <div className="tf-split-stat">
                  <BarChart3 size={13} />
                  <b>{(flagRate * 100).toFixed(0)}%</b>
                  <span>flag rate</span>
                </div>
              </div>
            </div>
          </section>

          <section className="tf-card tf-hero-card">
            <CardHead
              icon={<Activity size={16} />}
              tone="orange"
              title="Traffic signal"
              sub="Shaded bands are detected bursts · dashed line is μ+2σ"
              action={
                <div className="tf-seg" role="tablist" aria-label="Metric">
                  {METRICS.map((m) => (
                    <button
                      key={m.id}
                      role="tab"
                      aria-selected={metric === m.id}
                      className={cx(metric === m.id && 'on')}
                      onClick={() => setMetric(m.id)}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              }
            />
            <div className="tf-hero-body">
              <div className="tf-hero-top">
                <div className="tf-hero-figure">
                  <div className="tf-hero-num">
                    {fmtMetric(metric, seriesPeak)}
                    <small>{meta.unit}</small>
                  </div>
                  <div className="tf-hero-label">
                    <span>{meta.peakLabel}</span> · bucket {peakBucketRow.time}
                    <span className="tf-chip alert">
                      <Zap size={9} /> {((seriesPeak / seriesAvg - 1) * 100).toFixed(0)}% above mean
                    </span>
                    <span className="tf-chip soft">n={trafficSeries.length}</span>
                  </div>
                </div>
                <div className="tf-chip">
                  <TrendingUp size={9} /> σ {metric === 'bytes' ? seriesSigma.toFixed(1) : Math.round(seriesSigma)}
                </div>
              </div>
              <div className="tf-hero-chart">
                <Chart option={chartOption} height={252} />
              </div>
            </div>
            <div className="tf-hero-foot">
              <div className="tf-hero-cell orange">
                <b>{fmtMetric(metric, seriesAvg)}</b>
                <span>mean · {meta.unit}</span>
              </div>
              <div className="tf-hero-cell navy">
                <b>{fmtMetric(metric, p95(series))}</b>
                <span>p95 · {meta.unit}</span>
              </div>
              <div className="tf-hero-cell">
                <b>{fmtMetric(metric, seriesThreshold)}</b>
                <span>μ+2σ line · {meta.unit}</span>
              </div>
            </div>
          </section>

          <section className="tf-card tf-split-card">
            <CardHead icon={<BarChart3 size={16} />} title="What bursts carry" sub="Share of the day inside μ+2σ buckets" />
            <div className="tf-split-body">
              {shares.map((s) => (
                <div className="tf-share" key={s.label}>
                  <div className="tf-share-line">
                    <span>
                      <i />
                      {s.label}
                    </span>
                    <b>{(s.pct * 100).toFixed(1)}%</b>
                  </div>
                  <div className="tf-share-bar">
                    <div className={cx('tf-share-fill', s.tone)} style={{ width: `${Math.max(2, s.pct * 100)}%` }} />
                  </div>
                  <div className="tf-share-meta">
                    <b>{s.value}</b>
                    <span>· {bursts.length} of {trafficSeries.length} buckets</span>
                  </div>
                </div>
              ))}
              <div className="tf-compare">
                <div className="tf-compare-head">
                  <b>Load per bucket</b>
                  <span>req/s</span>
                </div>
                <div className="tf-compare-cols">
                  <div className="tf-compare-col">
                    <div className="tf-compare-track">
                      <div
                        className="tf-compare-fill orange"
                        style={{ height: `${(burstLoad / (compareMax * 1.14)) * 100}%` }}
                      />
                    </div>
                    <div className="tf-compare-val">
                      <b>{burstLoad.toFixed(0)}</b>
                      <span>burst</span>
                    </div>
                  </div>
                  <div className="tf-compare-col">
                    <div className="tf-compare-track">
                      <div
                        className="tf-compare-fill navy"
                        style={{ height: `${(baselineLoad / (compareMax * 1.14)) * 100}%` }}
                      />
                    </div>
                    <div className="tf-compare-val">
                      <b>{baselineLoad.toFixed(0)}</b>
                      <span>baseline</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section className="tf-card tf-queue-card">
            <CardHead
              icon={<Zap size={16} />}
              title="Burst register"
              sub="Every bucket with z ≥ 2, highest first"
              action={<span className="tf-chip soft">{zRows.length} flagged</span>}
            />
            <div className="tf-queue-body">
              <div className="tf-queue-head">
                <span>#</span>
                <span>Bucket</span>
                <span>Share of peak</span>
                <span>z-score</span>
              </div>
              <div className="tf-queue-rows">
                {zRows.map((r, i) => (
                  <button className="tf-queue-row" key={r.time} onClick={() => setSelected(r)}>
                    <span className="tf-queue-id">{String(i + 1).padStart(2, '0')}</span>
                    <span className="tf-queue-name">
                      <b>{r.time}</b>
                      <span>
                        {fmtInt(r.rps)} req/s · {fmtInt(r.failed)} auth failures · {(r.bytes / 1e6).toFixed(0)}MB
                      </span>
                    </span>
                    <span className="tf-queue-share">
                      <i>
                        <b style={{ width: `${(r.rps / maxRps) * 100}%` }} />
                      </i>
                    </span>
                    <span className={cx('tf-z-pill', r.z >= 3 && 'hot')}>{r.z.toFixed(2)}</span>
                  </button>
                ))}
                {zRows.length === 0 && (
                  <div className="tf-queue-row" style={{ display: 'block', color: 'var(--tf-muted)' }}>
                    No bucket exceeds μ+2σ in this window.
                  </div>
                )}
              </div>
            </div>
          </section>

          <section className="tf-card tf-rhythm-card">
            <CardHead icon={<Layers size={16} />} title="24-hour rhythm" sub="Requests per two-hour period" />
            <div className="tf-rhythm-body">
              <div className="tf-rhythm-hero">
                <div>
                  <div className="tf-rhythm-num">
                    {(busiestShare * 100).toFixed(0)}
                    <small>%</small>
                  </div>
                  <div className="tf-hero-label" style={{ marginTop: 6 }}>
                    <span>busiest block</span> · {busiest.hour}:00
                  </div>
                </div>
                <p className="tf-rhythm-note">
                  {fmtInt(busiestRequests)} requests sit in this two-hour window.
                </p>
              </div>
              <div className="tf-rhythm-grid">
                {PERIODS.map((p, i) => {
                  const blocks = blockCount(p.load, maxPeriod)
                  const hot = Math.round(blocks * p.burstShare)
                  return (
                    <div className="tf-rhythm-col" key={p.hour}>
                      <span className={cx('tf-rhythm-flag', p.flagged && 'on')} />
                      <div className="tf-rhythm-blocks">
                        {Array.from({ length: blocks }, (_, b) => (
                          <span
                            className={cx('tf-rhythm-block', b < hot ? 'orange' : b % 3 === 0 ? 'navy' : 'slate')}
                            key={b}
                            style={{ animationDelay: `${0.28 + i * 0.03 + b * 0.02}s` }}
                          />
                        ))}
                      </div>
                      <span className="tf-rhythm-hour">{p.hour}</span>
                    </div>
                  )
                })}
              </div>
              <div className="tf-rhythm-legend">
                <span>
                  <i style={{ background: 'var(--tf-orange)' }} /> Burst load
                </span>
                <span>
                  <i style={{ background: 'var(--tf-bar-2)' }} /> Baseline load
                </span>
                <span>
                  <i style={{ background: 'var(--tf-track)', border: '1px solid var(--tf-line)' }} /> Empty
                </span>
              </div>
            </div>
          </section>

          <section className="tf-card tf-dev-card">
            <CardHead
              icon={<TrendingUp size={16} />}
              title="Deviation spread"
              sub="Hover a band to read it, pin it to inspect buckets"
              action={
                pinned ? (
                  <button className="tf-mini-btn" onClick={() => setPinnedBin(null)}>
                    Clear
                  </button>
                ) : null
              }
            />
            <div className="tf-dev-body">
              <div className="tf-dev-readout" aria-live="polite">
                {activeBin ? (
                  <>
                    <div className="tf-dev-rohead">
                      <span className="tf-dev-roband">{binRange(activeBin)}</span>
                      <span className="tf-dev-rocount">
                        {activeBin.count}
                        <small>/{trafficSeries.length}</small>
                      </span>
                    </div>
                    <div className="tf-dev-rogrid">
                      <span>req/s in band</span>
                      <b>{bandLoad(activeBin)}</b>
                      <span>share of day</span>
                      <b>{((activeBin.count / trafficSeries.length) * 100).toFixed(1)}%</b>
                      <span>rule verdict</span>
                      <b className={activeBin.lo >= 2 ? 'hot' : ''}>
                        {activeBin.lo >= 2 ? 'flagged' : activeBin.lo >= 1 ? 'watch' : 'baseline'}
                      </b>
                    </div>
                    <div className="tf-dev-hint">
                      {pinnedBin === activeBinIndex
                        ? 'Pinned — click again to release.'
                        : 'Click to pin this band and list its busiest buckets.'}
                    </div>
                  </>
                ) : (
                  <>
                    <div className="tf-dev-rohead">
                      <span className="tf-dev-roband">The whole day</span>
                      <span className="tf-dev-rocount">
                        {trafficSeries.length}
                        <small>/ {trafficSeries.length}</small>
                      </span>
                    </div>
                    <div className="tf-dev-rogrid">
                      <span>mean μ</span>
                      <b>{avg.toFixed(0)} req/s</b>
                      <span>σ spread</span>
                      <b>{sigma.toFixed(0)} req/s</b>
                      <span>rule verdict</span>
                      <b className={bursts.length ? 'hot' : ''}>{bursts.length} flagged</b>
                    </div>
                    <div className="tf-dev-hint">Hover a band for its numbers, pin one to drill into buckets.</div>
                  </>
                )}
              </div>

              <div className={cx('tf-dev-rows', pinned && 'has-pin')} role="listbox" aria-label="Standard deviation bands">
                {zBins.map((b, i) => (
                  <button
                    type="button"
                    role="option"
                    aria-selected={pinnedBin === i}
                    key={b.label}
                    className={cx('tf-dev-row', pinnedBin === i && 'on', activeBinIndex === i && 'peek')}
                    onMouseEnter={() => setPeekedBin(i)}
                    onMouseLeave={() => setPeekedBin(null)}
                    onFocus={() => setPeekedBin(i)}
                    onBlur={() => setPeekedBin(null)}
                    onClick={() => toggleBin(i)}
                    onKeyDown={(e) => {
                      if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
                        e.preventDefault()
                        stepBin(i, 1)
                      }
                      if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
                        e.preventDefault()
                        stepBin(i, -1)
                      }
                      if (e.key === 'Escape') {
                        setPinnedBin(null)
                        setPeekedBin(null)
                      }
                    }}
                  >
                    <span className="tf-dev-label">{b.label}</span>
                    <span className="tf-dev-track">
                      <span
                        className={cx('tf-dev-fill', i >= 5 ? 'orange' : i === 4 ? 'navy' : '')}
                        style={{ width: `${maxBin ? Math.max(b.count / maxBin, 0.03) * 100 : 0}%` }}
                      />
                    </span>
                    <span className="tf-dev-count">{b.count}</span>
                  </button>
                ))}
              </div>

              {pinned && (
                <div className="tf-dev-pinned">
                  <div className="tf-dev-pinned-head">
                    <span className="tf-dev-roband">Pinned · {binRange(pinned)}</span>
                    <span className="tf-dev-pinned-note">
                      {pinned.count ? 'busiest buckets in band' : 'no buckets in band'}
                    </span>
                  </div>
                  <div className="tf-dev-chips">
                    {pinned.count === 0 ? (
                      <span className="tf-dev-empty">Nothing sits in this band — the day never ran here.</span>
                    ) : (
                      pinned.densest.map((t) => (
                        <button className="tf-bin-chip" key={t.time} onClick={() => setSelected(t)}>
                          {t.time}
                          <b>{Math.round(t.rps)}</b>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}

              <div className="tf-spread">
                <div className="tf-spread-head">
                  <div className="tf-foot-label raw">Spread window · μ ± kσ</div>
                  <div className="tf-spread-ticks">
                    {[1, 2, 3].map((k) => (
                      <button
                        key={k}
                        className={cx('tf-snap', Math.abs(spreadK - k) < 0.01 && 'on')}
                        onClick={() => setSpreadK(k)}
                      >
                        {k}σ
                      </button>
                    ))}
                  </div>
                </div>
                <div className="tf-spread-row">
                  <input
                    className="tf-range"
                    style={{ '--pct': `${spreadPct}%` } as CSSProperties}
                    type="range"
                    min={0.5}
                    max={3}
                    step={0.1}
                    value={spreadK}
                    aria-label="Spread window in standard deviations"
                    aria-valuetext={`${spreadK.toFixed(1)} sigma covers ${windowCount} of ${trafficSeries.length} buckets`}
                    onChange={(e) => setSpreadK(Number(e.target.value))}
                  />
                  <span className="tf-spread-k">
                    {spreadK.toFixed(1)}
                    <i>σ</i>
                  </span>
                </div>
                <div className="tf-spread-meta">
                  <span>
                    <b>{windowCount}</b> of {trafficSeries.length} buckets inside · {(windowPct * 100).toFixed(0)}%
                  </span>
                  <span className="tf-spread-out">
                    <b>{trafficSeries.length - windowCount}</b> outside
                  </span>
                </div>
              </div>

              <div className="tf-ladder">
                <div className="tf-foot-label">Throughput ladder · req/s</div>
                {ladder.map((l) => (
                  <div className="tf-ladder-row" key={l.label}>
                    <span className="tf-dev-label">{l.label}</span>
                    <span className="tf-ladder-track">
                      <i style={{ width: `${Math.max((l.value / peak) * 100, 2)}%` }} />
                    </span>
                    <span className="tf-ladder-val">{Math.round(l.value)}</span>
                  </div>
                ))}
              </div>
              <div className="tf-dev-note">
                <Info size={13} />
                <span>
                  Orange bands sit at or above +2σ — that is where the {bursts.length} flagged buckets live. The
                  distribution is right-skewed by the two bursts, which is exactly what the rule is meant to catch.
                </span>
              </div>
            </div>
          </section>

          <section className="tf-card tf-register-card" id="tf-register">
            <div className="tf-register-head">
              <div className="tf-titlewrap">
                <span className="tf-card-icon">
                  <Grid3X3 size={16} />
                </span>
                <div>
                  <h2 className="tf-card-title">Bucket register</h2>
                  <div className="tf-card-sub">All 48 half-hour buckets, oldest first</div>
                </div>
              </div>
              <div className="tf-seg" role="tablist" aria-label="Filter">
                <button
                  role="tab"
                  aria-selected={!onlyBursts}
                  className={cx(!onlyBursts && 'on')}
                  onClick={() => setOnlyBursts(false)}
                >
                  All buckets
                </button>
                <button
                  role="tab"
                  aria-selected={onlyBursts}
                  className={cx(onlyBursts && 'on')}
                  onClick={() => setOnlyBursts(true)}
                >
                  Bursts only
                </button>
              </div>
            </div>
            <div className="tf-register-scroll">
              <table className="tf-table">
                <thead>
                  <tr>
                    <th>Time</th>
                    <th className="right">req/s</th>
                    <th className="right">z</th>
                    <th className="right">MB</th>
                    <th className="right">Failures</th>
                    <th>Band</th>
                    <th>Reading</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((t) => {
                    const z = zOf(t)
                    return (
                      <tr
                        key={t.time}
                        className={cx('clickable', z >= 2 && 'burst')}
                        onClick={() => setSelected(t)}
                      >
                        <td className="tf-cell-time">{t.time}</td>
                        <td className="tf-cell-mono right">{fmtInt(t.rps)}</td>
                        <td className="right">
                          <span className={cx('tf-cell-z', z >= 2 && 'hot')}>{z.toFixed(2)}</span>
                        </td>
                        <td className="tf-cell-mono right">{(t.bytes / 1e6).toFixed(1)}</td>
                        <td className="tf-cell-mono right">{t.failed}</td>
                        <td>
                          <span className={cx('tf-band', z >= 2 && 'burst')}>
                            <i />
                            {z >= 2 ? 'Burst' : z >= 1 ? 'Elevated' : 'Baseline'}
                          </span>
                        </td>
                        <td className="tf-cell-mono" style={{ color: 'var(--tf-muted)' }}>
                          {z >= 2
                            ? 'above μ+2σ · inspect upstream'
                            : z >= 1
                              ? 'watch · within one step of the line'
                              : 'within baseline'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <div className="tf-table-foot">
              <span className="tf-inline">
                <Zap size={11} /> Threshold derived from this window only.
              </span>
              <span className="tf-inline">
                n={rows.length} · scroll for the rest
              </span>
            </div>
          </section>

          <section className="tf-card tf-foot-card">
            <CardHead
              icon={<Info size={16} />}
              tone="soft"
              title="How this view is computed"
              sub="Three transparent operations, no model claims"
            />
            <div className="tf-foot-body">
              <div className="tf-foot-stats">
                <div className="tf-foot-label">Statistics behind the board</div>
                <div className="tf-foot-grid">
                  {stats.map((s) => (
                    <div className="tf-foot-cell" key={s.name}>
                      <b>{s.value}</b>
                      <span>{s.name}</span>
                      <code>{s.formula}</code>
                    </div>
                  ))}
                </div>
              </div>
              <div className="tf-method">
                <div className="tf-foot-label">Method</div>
                <div className="tf-method-steps">
                  <div className="tf-method-step">
                    <i>01</i>
                    <div>
                      <b>Bucket</b>
                      <span>Events are grouped into 30-minute windows. Throughput is requests divided by 1,800 seconds.</span>
                    </div>
                  </div>
                  <div className="tf-method-step">
                    <i>02</i>
                    <div>
                      <b>Standardise</b>
                      <span>Each bucket is expressed as z = (x − μ) ÷ σ. The sample σ uses n − 1 in the denominator.</span>
                    </div>
                  </div>
                  <div className="tf-method-step">
                    <i>03</i>
                    <div>
                      <b>Flag</b>
                      <span>A bucket at or above μ+2σ is surfaced. No machine-learning claim is attached to this rule.</span>
                    </div>
                  </div>
                </div>
                <div className="tf-note">
                  <Info size={13} />
                  <span>
                    In deployment these buckets come from uploaded logs. The demo shows seeded edge traffic and says so.
                  </span>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>

      <Drawer open={!!selected} onClose={() => setSelected(null)} label="Bucket detail">
        {selected && (
          <>
            <DrawerHead
              overline={`Bucket · ${selected.time}`}
              title={`${fmtInt(selected.rps)} req/s`}
              meta={
                <span className="inline-flex" style={{ gap: 8 }}>
                  <span className={cx('badge', zOf(selected) >= 2 ? 'critical' : 'suppressed')}>
                    {zOf(selected) >= 2 ? 'burst' : 'baseline'}
                  </span>
                  <span className="mono" style={{ fontSize: 9 }}>
                    z {zOf(selected).toFixed(2)} · μ+2σ = {threshold.toFixed(0)} req/s
                  </span>
                </span>
              }
              onClose={() => setSelected(null)}
            />
            <div className="drawer-body">
              <div className="drawer-section">
                <h3>This bucket</h3>
                <div className="tf-drawer-figure">
                  <b>{(selected.bytes / 1e6).toFixed(1)}</b>
                  <span>MB served in this bucket</span>
                </div>
              </div>
              <div className="drawer-section">
                <h3>Against the day</h3>
                <div className="tf-drawer-rows">
                  {[
                    { label: 'Throughput', value: selected.rps, max: maxRps, unit: 'req/s' },
                    {
                      label: 'Volume',
                      value: Math.round(selected.bytes / 1e6),
                      max: Math.round(maxBytes / 1e6),
                      unit: 'MB',
                    },
                    { label: 'Auth failures', value: selected.failed, max: maxFailed, unit: 'failures' },
                  ].map((row) => (
                    <div className="tf-drawer-row" key={row.label}>
                      <div className="tf-drawer-line">
                        <span>{row.label}</span>
                        <b>
                          {fmtInt(row.value)} {row.unit}
                        </b>
                      </div>
                      <div className="tf-drawer-track">
                        <i style={{ width: `${(row.value / row.max) * 100}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="drawer-section">
                <p className="tf-drawer-note">
                  The μ+2σ line for this day sits at {threshold.toFixed(0)} req/s. This bucket is{' '}
                  {zOf(selected) >= 0 ? 'above' : 'below'} the mean by {Math.abs(zOf(selected)).toFixed(2)} standard
                  deviations, so the register marks it {zOf(selected) >= 2 ? 'as a burst' : 'as expected'}.
                </p>
              </div>
            </div>
          </>
        )}
      </Drawer>
    </div>
  )
}
