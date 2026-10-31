import { useMemo, useState, type ReactNode } from 'react'
import { Chart } from '../../components/Chart'
import { Drawer, DrawerHead } from '../../components/Drawer'
import {
  Activity,
  ArrowRight,
  BarChart3,
  Gauge,
  Globe2,
  Grid3X3,
  Info,
  KeyRound,
  Layers,
  ShieldAlert,
  ShieldCheck,
  Zap,
} from '../../components/Icons'
import { anomalyWindows } from '../../data/seed'
import { useTheme } from '../../lib/store'
import { cx } from '../../lib/format'
import { mean, median, quantile, stdev } from '../../lib/stats'
import type { LogWindow } from '../../lib/types'
import './anomalies.css'

const THRESHOLD = 0.2
const MONO = "'JetBrains Mono Variable', ui-monospace, monospace"
const DISPLAY = "'Space Grotesk Variable', 'Inter Variable', system-ui, sans-serif"

type Metric = 'score' | 'logins' | 'rps'

const METRICS: { id: Metric; label: string; unit: string; peakLabel: string }[] = [
  { id: 'score', label: 'Score', unit: 'isolation score', peakLabel: 'peak anomaly score' },
  { id: 'logins', label: 'Logins', unit: 'failed logins', peakLabel: 'peak failed logins' },
  { id: 'rps', label: 'Requests', unit: 'requests / second', peakLabel: 'peak request rate' },
]

const metricValue = (w: LogWindow, metric: Metric) =>
  metric === 'score' ? w.anomalyScore : metric === 'logins' ? w.failedLogins : w.rps

const fmtMetric = (metric: Metric, value: number) => (metric === 'score' ? value.toFixed(2) : String(Math.round(value)))

const score2 = (n: number) => n.toFixed(2)

const reasonMeta = (reason?: string) => {
  if (reason?.toLowerCase().includes('credential')) return { icon: KeyRound, tone: 'navy', short: 'Credential stuffing' }
  if (reason?.toLowerCase().includes('country')) return { icon: Globe2, tone: 'navy', short: 'Geo novelty' }
  if (reason?.toLowerCase().includes('off-hours')) return { icon: Activity, tone: '', short: 'Off-hours activity' }
  return { icon: Zap, tone: '', short: 'Brute-force burst' }
}

const flagged = anomalyWindows.filter((w) => w.anomaly)
const watch = anomalyWindows.filter((w) => !w.anomaly && w.anomalyScore > -0.1)
const baseline = anomalyWindows.filter((w) => !w.anomaly && w.anomalyScore <= -0.1)
const flagRate = flagged.length / anomalyWindows.length
const flaggedLoad = flagged.reduce((sum, w) => sum + w.failedLogins, 0)
const normalLoad = anomalyWindows.filter((w) => !w.anomaly).reduce((sum, w) => sum + w.failedLogins, 0)
const scores = anomalyWindows.map((w) => w.anomalyScore)
const maxLogins = Math.max(...anomalyWindows.map((w) => w.failedLogins))
const maxIps = Math.max(...anomalyWindows.map((w) => w.distinctIps))
const maxRps = Math.max(...anomalyWindows.map((w) => w.rps))

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const dayStats = DAYS.map((day) => {
  const windows = anomalyWindows.filter((w) => w.label.startsWith(day))
  return {
    day,
    logins: Math.max(...windows.map((w) => w.failedLogins)),
    ips: Math.max(...windows.map((w) => w.distinctIps)),
    rps: Math.max(...windows.map((w) => w.rps)),
    flagged: windows.filter((w) => w.anomaly).length,
    count: windows.length,
  }
})

const mix = flagged
  .map((w) => ({ id: w.id, label: reasonMeta(w.reason).short, logins: w.failedLogins, reason: w.reason ?? '' }))
  .sort((a, b) => b.logins - a.logins)

const MIX_COLORS = ['var(--an-orange)', 'var(--an-bar-2)', 'var(--an-bar-3)', 'var(--an-bar-4)']
const stat2 = (n: number) => (Math.abs(n) < 0.005 ? '0.00' : n.toFixed(2))
const blockCount = (value: number, max: number) => Math.max(1, Math.round((value / max) * 10))

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
        stroke="var(--an-line)"
        strokeWidth={i % 5 === 0 ? 1.4 : 0.9}
      />
    )
  })

  return (
    <svg viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${segments[0].count} of ${total} windows flagged`}>
      <circle
        cx={center}
        cy={center}
        r={radius}
        fill="none"
        stroke="var(--an-track)"
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
            className="an-gauge-seg"
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
        stroke="var(--an-line-2)"
        strokeWidth={1}
        strokeDasharray={`${(circum * sweep) / 360} ${circum}`}
        transform={`rotate(135 ${center} ${center})`}
      />
      {ticks}
      <circle cx={center} cy={center} r={radius - stroke * 1.55} fill="none" stroke="var(--an-line)" strokeWidth={0.6} />
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
    <div className="an-card-head">
      <div className="an-titlewrap">
        <span className={cx('an-card-icon', tone)}>{icon}</span>
        <div>
          <h2 className="an-card-title">{title}</h2>
          <div className="an-card-sub">{sub}</div>
        </div>
      </div>
      {action}
    </div>
  )
}

export default function Anomalies() {
  const theme = useTheme((s) => s.theme)
  const [selected, setSelected] = useState<LogWindow | null>(null)
  const [onlyAnomalies, setOnlyAnomalies] = useState(false)
  const [metric, setMetric] = useState<Metric>('score')

  const dark = theme === 'dark'
  const accent = dark ? '#ff6a36' : '#ff5a1f'
  const navy = dark ? '#c9d8ea' : '#14263e'
  const axisColor = dark ? '#6f849a' : '#a8a29a'
  const gridColor = dark ? 'rgba(255,255,255,0.06)' : 'rgba(16,29,45,0.07)'
  const cardColor = dark ? '#121f2c' : '#fffdf9'

  const peak = useMemo(
    () => [...anomalyWindows].sort((a, b) => metricValue(b, metric) - metricValue(a, metric))[0],
    [metric],
  )

  const meta = METRICS.find((m) => m.id === metric)!

  const chartOption = useMemo(() => {
    const lineColor = metric === 'rps' ? (dark ? '#8fa3b8' : '#8d99a8') : metric === 'logins' ? navy : accent
    const areaTop = metric === 'score' ? accent : lineColor
    const values = anomalyWindows.map((w) => metricValue(w, metric))
    const allAnomalies = anomalyWindows.map((w) => w.anomaly)

    const featureBar = (label: string, value: number, max: number, color: string) =>
      `<div style="display:grid;grid-template-columns:76px 34px minmax(0,1fr);align-items:center;gap:7px;font:500 8.5px ${MONO};color:#8fa3b8">
        <span style="letter-spacing:.02em">${label}</span>
        <span style="color:#e9f0f8;text-align:right">${value}</span>
        <span style="display:block;height:4px;border-radius:99px;background:rgba(255,255,255,.09)">
          <span style="display:block;height:100%;width:${Math.round((value / max) * 100)}%;border-radius:99px;background:${color}"></span>
        </span>
      </div>`

    return {
      animationDuration: 900,
      grid: { left: 44, right: 18, top: 30, bottom: 30 },
      xAxis: {
        type: 'category',
        boundaryGap: false,
        data: anomalyWindows.map((w) => w.label),
        axisLine: { lineStyle: { color: gridColor } },
        axisTick: { show: false },
        axisLabel: {
          color: axisColor,
          fontSize: 8.5,
          fontFamily: MONO,
          interval: 2,
          margin: 12,
        },
      },
      yAxis: {
        type: 'value',
        min: metric === 'score' ? -0.3 : 0,
        max: metric === 'score' ? 0.6 : undefined,
        splitNumber: 3,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: {
          color: axisColor,
          fontSize: 8.5,
          fontFamily: MONO,
          formatter: (value: number) => (metric === 'score' ? value.toFixed(1) : String(value)),
        },
        splitLine: { lineStyle: { color: gridColor, type: 'dashed' } },
      },
      tooltip: {
        trigger: 'axis',
        backgroundColor: 'rgba(10,17,27,0.97)',
        borderWidth: 0,
        padding: [12, 14],
        extraCssText: 'border-radius:16px;box-shadow:0 24px 50px -20px rgba(0,0,0,.65);',
        axisPointer: {
          type: 'line',
          lineStyle: { color: accent, width: 1, type: 'dashed' },
        },
        formatter: (params: any) => {
          const index = params?.[0]?.dataIndex ?? 0
          const w = anomalyWindows[index]
          const value = metricValue(w, metric)
          const prev = index > 0 ? metricValue(anomalyWindows[index - 1], metric) : null
          const delta = prev == null ? null : value - prev
          return `<div style="min-width:206px">
            <div style="display:flex;justify-content:space-between;gap:18px;font:500 8.5px ${MONO};letter-spacing:.12em;text-transform:uppercase;color:#7d8ea3">
              <span>${w.id} · ${w.label}</span>
              <span style="color:${w.anomaly ? '#ff9b74' : '#7fe0d2'}">${w.anomaly ? 'Flagged' : 'Baseline'}</span>
            </div>
            <div style="display:flex;align-items:baseline;gap:7px;margin-top:9px">
              <span style="font:600 26px/1 ${DISPLAY};letter-spacing:-.045em;color:#f4f8fc">${fmtMetric(metric, value)}</span>
              <span style="font:500 8.5px ${MONO};color:#8fa3b8">${meta.unit}</span>
              ${delta == null ? '' : `<span style="margin-left:auto;font:500 8.5px ${MONO};color:${delta > 0 ? '#ff9b74' : '#7fe0d2'}">${delta > 0 ? '+' : ''}${fmtMetric(metric, delta)}</span>`}
            </div>
            <div style="margin-top:11px;display:grid;gap:5px">
              ${featureBar('Failed logins', w.failedLogins, maxLogins, '#ff7a45')}
              ${featureBar('Distinct IPs', w.distinctIps, maxIps, '#c9d8ea')}
              ${featureBar('Requests /s', w.rps, maxRps, '#7f93a9')}
            </div>
          </div>`
        },
      },
      series: [
        {
          type: 'line',
          data: values,
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
          markLine:
            metric === 'score'
              ? {
                  silent: true,
                  symbol: 'none',
                  lineStyle: { color: '#e08a2f', type: 'dashed', width: 1, opacity: 0.75 },
                  label: {
                    formatter: 'threshold 0.20',
                    color: '#b4701f',
                    fontSize: 8,
                    fontFamily: MONO,
                    position: 'insideEndTop',
                  },
                  data: [{ yAxis: THRESHOLD }],
                }
              : undefined,
          markPoint: {
            symbol: 'circle',
            symbolSize: 7,
            itemStyle: { color: lineColor, borderColor: cardColor, borderWidth: 2 },
            label: { show: false },
            data: allAnomalies
              .map((isAnomaly, index) => ({ isAnomaly, index }))
              .filter((d) => d.isAnomaly)
              .map((d) => ({ coord: [d.index, values[d.index]] })),
          },
        },
      ],
    }
  }, [metric, dark, accent, navy, axisColor, gridColor, cardColor, meta])

  const scrollToRegister = () => document.getElementById('an-register')?.scrollIntoView({ behavior: 'smooth', block: 'start' })

  const rows = onlyAnomalies ? flagged : anomalyWindows

  const peakValue = metricValue(peak, metric)

  return (
    <div className="anomalies-page">
      <div className="an-shell">
        <header className="an-head">
          <div className="an-head-copy">
            <span className="an-eyebrow">Component 09 · Anomaly detection</span>
            <h1>
              Behaviour that breaks <em>the baseline</em>
            </h1>
            <p>
              Auth logs are reduced to six-hour windows, compared against the learned baseline, and only deviations
              above the threshold surface with their evidence attached.
            </p>
          </div>
          <div className="an-head-side">
            <div className="an-pillrow">
              <span className="an-pill">
                <span className="an-dot" />
                User upload
              </span>
              <span className="an-pill ghost">Demo windows · {anomalyWindows.length}</span>
            </div>
            <button className="an-btn dark" onClick={scrollToRegister}>
              Window register <ArrowRight size={13} />
            </button>
          </div>
        </header>

        <div className="an-grid">
          <section className="an-card an-gauge-card">
            <CardHead
              icon={<Gauge size={16} />}
              title="Flag exposure"
              sub="18 windows across the demo week"
              action={
                <button className="an-icon-btn" aria-label="About the gauge" onClick={scrollToRegister}>
                  <Info size={13} />
                </button>
              }
            />
            <div className="an-gauge-body">
              <div className="an-gauge-ring">
                <GaugeArc
                  total={anomalyWindows.length}
                  segments={[
                    { count: flagged.length, color: 'var(--an-orange)' },
                    { count: watch.length, color: 'var(--an-watch)' },
                    { count: baseline.length, color: 'var(--an-slate-2)' },
                  ]}
                />
                <div className="an-gauge-center">
                  <div className="an-gauge-value">
                    {String(flagged.length).padStart(2, '0')}
                    <small>/{anomalyWindows.length}</small>
                  </div>
                  <div className="an-gauge-label">flagged windows</div>
                </div>
              </div>
              <div className="an-gauge-legend">
                <span>
                  <i style={{ background: 'var(--an-orange)' }} /> Flagged · {flagged.length}
                </span>
                <span>
                  <i style={{ background: 'var(--an-watch)' }} /> Watch · {watch.length}
                </span>
                <span>
                  <i style={{ background: 'var(--an-slate-2)' }} /> Baseline · {baseline.length}
                </span>
              </div>
              <div className="an-split-stats">
                <div className="an-split-stat">
                  <Zap size={13} />
                  <b>{score2(Math.max(...scores))}</b>
                  <span>peak score</span>
                </div>
                <div className="an-split-stat">
                  <ShieldAlert size={13} />
                  <b>{Math.round(flagRate * 100)}%</b>
                  <span>flag rate</span>
                </div>
                <div className="an-split-stat">
                  <Activity size={13} />
                  <b>{score2(median(scores))}</b>
                  <span>median score</span>
                </div>
              </div>
            </div>
          </section>

          <section className="an-card an-hero-card">
            <CardHead
              icon={<Activity size={16} />}
              tone="orange"
              title="Anomaly signal"
              sub="Six-hour windows · threshold held at 0.20"
              action={
                <div className="an-seg" role="tablist" aria-label="Chart metric">
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
            <div className="an-hero-body">
              <div className="an-hero-top">
                <div className="an-hero-figure">
                  <div className="an-hero-num">
                    {fmtMetric(metric, peakValue)}
                    <small>{metric === 'score' ? '' : metric === 'logins' ? 'logins' : 'req/s'}</small>
                  </div>
                  <div className="an-hero-label">
                    <span>{meta.peakLabel}</span>
                    <span className="an-chip soft">{peak.label}</span>
                    {metric === 'score' && (
                      <span className="an-chip alert">+{score2(peakValue - THRESHOLD)} over threshold</span>
                    )}
                    {metric !== 'score' && peak.anomaly && <span className="an-chip alert">flagged window</span>}
                  </div>
                </div>
                <div className="an-hero-actions">
                  <button className="an-btn ghost" onClick={() => setSelected(peak)}>
                    Details
                  </button>
                </div>
              </div>

              <div className="an-hero-chart">
                <Chart option={chartOption} height={252} />
              </div>

              <div className="an-hero-foot">
                <div className="an-hero-cell orange">
                  <b>{flagged.length} of {anomalyWindows.length}</b>
                  <span>windows above threshold</span>
                </div>
                <div className="an-hero-cell navy">
                  <b>{score2(THRESHOLD)}</b>
                  <span>fixed cut · auditable</span>
                </div>
                <div className="an-hero-cell">
                  <b>{score2(median(scores))}</b>
                  <span>median score · full week</span>
                </div>
              </div>
            </div>
          </section>

          <section className="an-card an-mix-card">
            <CardHead
              icon={<BarChart3 size={16} />}
              tone="soft"
              title="Signal mix"
              sub="Failed logins by driver"
              action={<span className="an-chip soft">{flaggedLoad} logins</span>}
            />
            <div className="an-mix-body">
              <div className="an-mix-rows">
                {mix.map((item, index) => (
                  <div className="an-mix-row" key={item.id}>
                    <div className="an-mix-line">
                      <span>{item.label}</span>
                      <b>{((item.logins / flaggedLoad) * 100).toFixed(1)}%</b>
                    </div>
                    <div className="an-mix-bar">
                      <i
                        style={{
                          width: `${Math.max((item.logins / flaggedLoad) * 100, 3)}%`,
                          background: MIX_COLORS[index % MIX_COLORS.length],
                        }}
                      />
                    </div>
                    <div className="an-mix-meta">
                      <span>{item.id}</span>
                      <span>{item.logins} logins</span>
                    </div>
                  </div>
                ))}
              </div>

              <div className="an-compare">
                <div className="an-compare-head">
                  <b>Flagged vs baseline load</b>
                  <span>6h windows</span>
                </div>
                <div className="an-compare-cols">
                  <div className="an-compare-col">
                    <div className="an-compare-track">
                      <div className="an-compare-fill orange" style={{ height: `${(flaggedLoad / flaggedLoad) * 100}%` }} />
                    </div>
                    <div className="an-compare-val">
                      <b>{flaggedLoad}</b>
                      <span>flagged</span>
                    </div>
                  </div>
                  <div className="an-compare-col">
                    <div className="an-compare-track">
                      <div className="an-compare-fill navy" style={{ height: `${(normalLoad / flaggedLoad) * 100}%` }} />
                    </div>
                    <div className="an-compare-val">
                      <b>{normalLoad}</b>
                      <span>baseline</span>
                    </div>
                  </div>
                </div>
                <div className="an-mix-cta">
                  <span className="an-chip soft">{flagged.length} windows carry the load</span>
                  <button className="an-link" onClick={scrollToRegister}>
                    Open register <ArrowRight size={11} />
                  </button>
                </div>
              </div>
            </div>
          </section>

          <section className="an-card an-queue-card">
            <CardHead
              icon={<ShieldAlert size={16} />}
              title="Priority queue"
              sub="Flagged windows, highest score first"
              action={<span className="an-chip alert">needs review</span>}
            />
            <div className="an-queue-body">
              <div className="an-queue-head">
                <span>Window / driver</span>
                <span>Share</span>
                <span>Score</span>
              </div>
              <div className="an-queue-rows">
                {[...flagged]
                  .sort((a, b) => b.anomalyScore - a.anomalyScore)
                  .map((w) => {
                    const driver = reasonMeta(w.reason)
                    const DriverIcon = driver.icon
                    return (
                      <button className="an-queue-row" key={w.id} onClick={() => setSelected(w)}>
                        <span className="an-queue-id">
                          <span className={cx('an-driver', driver.tone)}>
                            <DriverIcon size={13} />
                          </span>
                          <span className="an-queue-name">
                            <b>{w.label}</b>
                            <span>{w.reason}</span>
                          </span>
                        </span>
                        <span className="an-queue-share">{((w.failedLogins / flaggedLoad) * 100).toFixed(1)}%</span>
                        <span className="an-score-pill">{score2(w.anomalyScore)}</span>
                      </button>
                    )
                  })}
              </div>
              <div className="an-mix-cta" style={{ marginTop: 'auto' }}>
                <span className="an-chip soft">threshold {score2(THRESHOLD)}</span>
                <button className="an-link" onClick={scrollToRegister}>
                  Full register <ArrowRight size={11} />
                </button>
              </div>
            </div>
          </section>

          <section className="an-card an-print-card">
            <CardHead icon={<Grid3X3 size={16} />} tone="soft" title="Feature print" sub="Peak intensity per day" />
            <div className="an-print-body">
              <div className="an-print-hero">
                <div>
                  <div className="an-print-num">
                    {Math.round(flagRate * 100)}
                    <small>%</small>
                  </div>
                  <div className="an-print-note">
                    of windows flagged across {DAYS.length} days · {flagged.length} of {anomalyWindows.length}
                  </div>
                </div>
              </div>

              <div className="an-print-grid">
                {dayStats.map((day) => (
                  <div
                    className="an-print-col"
                    key={day.day}
                    title={`${day.day} · ${day.count} windows · ${day.flagged} flagged · peak ${day.logins} logins / ${day.ips} IPs / ${day.rps} rps`}
                  >
                    <span className={cx('an-print-flag', day.flagged > 0 && 'on')} aria-hidden="true" />
                    <div className="an-print-stacks">
                      {[
                        { key: 'logins', tone: 'orange', count: blockCount(day.logins, maxLogins) },
                        { key: 'ips', tone: 'navy', count: blockCount(day.ips, maxIps) },
                        { key: 'rps', tone: 'slate', count: blockCount(day.rps, maxRps) },
                      ].flatMap((stack) =>
                        Array.from({ length: stack.count }, (_, index) => (
                          <span
                            key={`${stack.key}-${index}`}
                            className={cx('an-print-block', stack.tone)}
                            aria-hidden="true"
                          />
                        )),
                      )}
                    </div>
                    <span className="an-print-day">{day.day}</span>
                  </div>
                ))}
              </div>

              <div className="an-print-legend">
                <span>
                  <i style={{ background: 'var(--an-orange)' }} /> Failed logins
                </span>
                <span>
                  <i style={{ background: 'var(--an-bar-2)' }} /> Distinct IPs
                </span>
                <span>
                  <i style={{ background: 'var(--an-bar-3)' }} /> Requests /s
                </span>
              </div>
            </div>
          </section>

          <section className="an-card an-register-card" id="an-register">
            <div className="an-card-head an-register-head">
              <div className="an-titlewrap">
                <span className="an-card-icon">
                  <Layers size={16} />
                </span>
                <div>
                  <h2 className="an-card-title">Window register</h2>
                  <div className="an-card-sub">
                    {rows.length} windows · {flagged.length} flagged · evidence recorded per window
                  </div>
                </div>
              </div>
              <div className="an-register-tools">
                <div className="an-seg" role="tablist" aria-label="Window filter">
                  <button
                    role="tab"
                    aria-selected={!onlyAnomalies}
                    className={cx(!onlyAnomalies && 'on')}
                    onClick={() => setOnlyAnomalies(false)}
                  >
                    All windows
                  </button>
                  <button
                    role="tab"
                    aria-selected={onlyAnomalies}
                    className={cx(onlyAnomalies && 'on')}
                    onClick={() => setOnlyAnomalies(true)}
                  >
                    Flagged
                  </button>
                </div>
              </div>
            </div>
            <div className="an-register-scroll">
              <table className="an-table">
                <thead>
                  <tr>
                    <th>Window</th>
                    <th className="right">Failed logins</th>
                    <th className="right">Distinct IPs</th>
                    <th className="right">RPS</th>
                    <th className="right">Country novelty</th>
                    <th className="right">Score</th>
                    <th>Finding</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((w) => (
                    <tr
                      key={w.id}
                      className={cx('clickable', w.anomaly && 'flagged')}
                      onClick={() => setSelected(w)}
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') setSelected(w)
                      }}
                    >
                      <td>
                        <span className="an-cell-window">{w.label}</span>{' '}
                        <span className="an-cell-mono" style={{ color: 'var(--an-muted-2)' }}>
                          {w.id}
                        </span>
                      </td>
                      <td className="right an-cell-mono">{w.failedLogins}</td>
                      <td className="right an-cell-mono">{w.distinctIps}</td>
                      <td className="right an-cell-mono">{w.rps}</td>
                      <td className="right an-cell-mono">{w.countryNovelty}</td>
                      <td className="right">
                        <span className={cx('an-cell-score', !w.anomaly && 'quiet')}>{score2(w.anomalyScore)}</span>
                      </td>
                      <td>
                        {w.anomaly ? (
                          <span className="an-finding">
                            <i />
                            {w.reason}
                          </span>
                        ) : (
                          <span className="an-finding quiet">within baseline</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="an-table-foot">
              <span className="an-inline">
                <ShieldCheck size={12} /> Missing optional log fields are tolerated; missing timestamp or event type
                rejects the row.
              </span>
              <span className="an-mono">n={rows.length} · scroll</span>
            </div>
          </section>

          <section className="an-card an-foot-card">
            <div className="an-foot-body">
              <div className="an-foot-stats">
                <div className="an-foot-label">
                  Layer B · statistics <span className="an-chip soft">demo windows</span>
                </div>
                <div className="an-foot-grid">
                  {[
                    { label: 'Mean score', value: stat2(mean(scores)) },
                    { label: 'Median', value: stat2(median(scores)) },
                    { label: 'p95', value: stat2(quantile(scores, 0.95)) },
                    { label: 'Dispersion σ', value: stat2(stdev(scores)) },
                    { label: 'Flag rate', value: `${(flagRate * 100).toFixed(1)}%` },
                  ].map((stat) => (
                    <div className="an-foot-cell" key={stat.label}>
                      <b>{stat.value}</b>
                      <span>{stat.label}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="an-method">
                <div className="an-foot-label">How the score is built</div>
                <div className="an-method-steps">
                  {[
                    ['Reduce logs', 'Six-hour windows per destination asset.'],
                    ['Build features', 'Failures, distinct IPs, RPS, geo novelty.'],
                    ['Score isolation', 'Precomputed IsolationForest-aligned scores.'],
                    ['Apply threshold', 'Fixed 0.20 cut keeps the demo auditable.'],
                  ].map(([title, body], index) => (
                    <div className="an-method-step" key={title}>
                      <i>{String(index + 1).padStart(2, '0')}</i>
                      <div>
                        <b>{title}</b>
                        <span>{body}</span>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="an-note">
                  <Info size={12} />
                  <span>
                    These window-level scores are demonstration data, not a claim that a model detected these events
                    in a live environment.
                  </span>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>

      <Drawer open={Boolean(selected)} onClose={() => setSelected(null)} label="Anomaly window">
        {selected && (
          <>
            <DrawerHead
              overline={`${selected.id} · ${selected.anomaly ? 'FLAGGED' : 'WITHIN BASELINE'}`}
              title={selected.label}
              onClose={() => setSelected(null)}
              meta={
                <span className="inline-flex" style={{ gap: 8 }}>
                  <span className="badge upload">USER UPLOAD</span>
                  <span className="badge simulated">demo windows</span>
                </span>
              }
            />
            <div className="drawer-body">
              <div className="drawer-section">
                <p className="an-drawer-note">
                  {selected.anomaly
                    ? selected.reason
                    : 'This window sits inside the learned baseline. No alert was raised.'}
                </p>
              </div>
              <div className="drawer-section">
                <h3>Features</h3>
                <div className="provenance-list">
                  <div className="provenance-row">
                    <span className="check">✓</span>
                    <span>Failed logins</span>
                    <span className="time">{selected.failedLogins}</span>
                  </div>
                  <div className="provenance-row">
                    <span className="check">✓</span>
                    <span>Distinct source IPs</span>
                    <span className="time">{selected.distinctIps}</span>
                  </div>
                  <div className="provenance-row">
                    <span className="check">✓</span>
                    <span>Requests per second</span>
                    <span className="time">{selected.rps}</span>
                  </div>
                  <div className="provenance-row">
                    <span className="check">✓</span>
                    <span>Country novelty</span>
                    <span className="time">{selected.countryNovelty} new</span>
                  </div>
                  <div className="provenance-row">
                    <span className="check">✓</span>
                    <span>Isolation score</span>
                    <span className="time">{score2(selected.anomalyScore)}</span>
                  </div>
                </div>
              </div>
              <div className="drawer-section">
                <h3>Suggested next step</h3>
                <div className="action-box">
                  <strong style={{ fontSize: 12 }}>
                    {selected.anomaly
                      ? selected.reason?.toLowerCase().includes('country')
                        ? 'Verify the user, revoke sessions, and challenge the sign-in from the new region.'
                        : selected.reason?.toLowerCase().includes('credential')
                          ? 'Rate-limit the login surface and force step-up authentication.'
                          : 'Correlate source IPs with the firewall log and confirm whether the burst was authorised.'
                      : 'No action. Keep this window as part of the baseline.'}
                  </strong>
                </div>
              </div>
            </div>
          </>
        )}
      </Drawer>
    </div>
  )
}
