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
import { cx, timeAgo } from '../../lib/format'
import { useLoginCapture } from '../../lib/loginFeed'
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
  metric === 'score' ? w.anomalyScore : metric === 'logins' ? (w.failuresSoFar ?? w.failedLogins) : w.rps

const fmtMetric = (metric: Metric, value: number) => (metric === 'score' ? value.toFixed(2) : String(Math.round(value)))

const score2 = (n: number) => n.toFixed(2)

const reasonMeta = (reason?: string) => {
  const text = reason?.toLowerCase() ?? ''
  if (text.includes('takeover')) return { icon: ShieldAlert, tone: 'navy', short: 'Account takeover' }
  if (text.includes('credential')) return { icon: KeyRound, tone: 'navy', short: 'Credential stuffing' }
  if (text.includes('spray')) return { icon: Activity, tone: 'navy', short: 'Password spray' }
  if (text.includes('travel')) return { icon: Globe2, tone: 'navy', short: 'Impossible travel' }
  if (text.includes('country')) return { icon: Globe2, tone: 'navy', short: 'Geo novelty' }
  if (text.includes('scripted')) return { icon: Zap, tone: '', short: 'Scripted client' }
  if (text.includes('distributed')) return { icon: Layers, tone: '', short: 'Distributed activity' }
  if (text.includes('off-hours')) return { icon: Activity, tone: '', short: 'Off-hours activity' }
  return { icon: Zap, tone: '', short: 'Brute-force burst' }
}

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MIX_COLORS = ['var(--an-orange)', 'var(--an-bar-2)', 'var(--an-bar-3)', 'var(--an-bar-4)']
const stat2 = (n: number) => (Math.abs(n) < 0.005 ? '0.00' : n.toFixed(2))
const blockCount = (value: number, max: number) => Math.max(1, Math.round((value / Math.max(1, max)) * 10))

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
    <svg viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${segments[0].count} of ${total} requests flagged`}>
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
        const degrees = (segment.count / Math.max(1, total)) * sweep
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
  const capture = useLoginCapture()
  const [selected, setSelected] = useState<LogWindow | null>(null)
  const [onlyAnomalies, setOnlyAnomalies] = useState(false)
  const [metric, setMetric] = useState<Metric>('score')

  const liveCapture = capture.windows.length > 0
  const windows = liveCapture ? capture.windows : anomalyWindows

  /* In live mode every failed request is a flag, regardless of the score band. */
  const flagged = liveCapture
    ? windows.filter((w) => w.failedLogins > 0)
    : windows.filter((w) => w.anomaly)
  const watch = liveCapture
    ? windows.filter((w) => !w.failedLogins && w.anomaly)
    : windows.filter((w) => !w.anomaly && w.anomalyScore > -0.1)
  const baseline = liveCapture
    ? windows.filter((w) => !w.failedLogins && !w.anomaly)
    : windows.filter((w) => !w.anomaly && w.anomalyScore <= -0.1)

  const flagRate = flagged.length / Math.max(1, windows.length)
  const flaggedLoad = flagged.reduce((sum, w) => sum + w.failedLogins, 0)
  const normalLoad = liveCapture
    ? windows.length - flagged.length
    : windows.filter((w) => !w.anomaly).reduce((sum, w) => sum + w.failedLogins, 0)
  const scores = windows.map((w) => w.anomalyScore)
  const maxLogins = Math.max(1, ...windows.map((w) => w.failuresSoFar ?? w.failedLogins))
  const maxIps = Math.max(1, ...windows.map((w) => w.distinctIps))
  const maxRps = Math.max(1, ...windows.map((w) => w.rps))

  const printStats = useMemo(() => {
    if (!liveCapture) {
      return DAYS.map((day) => {
        const dayWindows = windows.filter((w) => w.label.startsWith(day))
        return {
          day,
          logins: Math.max(0, ...dayWindows.map((w) => w.failedLogins)),
          ips: Math.max(0, ...dayWindows.map((w) => w.distinctIps)),
          rps: Math.max(0, ...dayWindows.map((w) => w.rps)),
          flagged: dayWindows.filter((w) => w.anomaly).length,
          count: dayWindows.length,
        }
      })
    }
    const buckets = Math.max(1, Math.min(6, windows.length))
    return Array.from({ length: buckets }, (_, index) => {
      const start = Math.floor((index * windows.length) / buckets)
      const end = Math.max(start + 1, Math.floor(((index + 1) * windows.length) / buckets))
      const slice = windows.slice(start, end)
      const last = slice[slice.length - 1]
      return {
        day: last.label.includes(' ') ? last.label.split(' ').pop() ?? last.label : last.label,
        logins: Math.max(0, ...slice.map((w) => w.failuresSoFar ?? w.failedLogins)),
        ips: Math.max(0, ...slice.map((w) => w.distinctIps)),
        rps: Math.max(0, ...slice.map((w) => w.rps)),
        flagged: slice.filter((w) => w.failedLogins > 0).length,
        count: slice.length,
      }
    })
  }, [liveCapture, windows])

  const mix = useMemo(() => {
    if (!liveCapture) {
      return flagged
        .map((w) => ({ id: w.id, label: reasonMeta(w.reason).short, logins: w.failedLogins, reason: w.reason ?? '' }))
        .sort((a, b) => b.logins - a.logins)
    }
    const groups = new Map<string, { id: string; label: string; logins: number; reason: string }>()
    flagged.forEach((w) => {
      const meta = reasonMeta(w.reason)
      const entry = groups.get(meta.short) ?? { id: `MIX-${meta.short}`, label: meta.short, logins: 0, reason: w.reason ?? '' }
      entry.logins += 1
      groups.set(meta.short, entry)
    })
    return [...groups.values()].sort((a, b) => b.logins - a.logins)
  }, [liveCapture, flagged])

  const dark = theme === 'dark'
  const accent = dark ? '#ff6a36' : '#ff5a1f'
  const navy = dark ? '#c9d8ea' : '#14263e'
  const axisColor = dark ? '#6f849a' : '#a8a29a'
  const gridColor = dark ? 'rgba(255,255,255,0.06)' : 'rgba(16,29,45,0.07)'
  const cardColor = dark ? '#121f2c' : '#fffdf9'

  const peak = useMemo(
    () => [...windows].sort((a, b) => metricValue(b, metric) - metricValue(a, metric))[0] ?? windows[0],
    [windows, metric],
  )

  const meta = METRICS.find((m) => m.id === metric)!

  const chartOption = useMemo(() => {
    const lineColor = metric === 'rps' ? (dark ? '#8fa3b8' : '#8d99a8') : metric === 'logins' ? navy : accent
    const areaTop = metric === 'score' ? accent : lineColor
    const values = windows.map((w) => metricValue(w, metric))
    const allAnomalies = windows.map((w) => w.anomaly)
    const labelInterval = liveCapture ? Math.max(1, Math.ceil(windows.length / 10)) : 2

    const featureBar = (label: string, value: number, max: number, color: string) =>
      `<div style="display:grid;grid-template-columns:76px 34px minmax(0,1fr);align-items:center;gap:7px;font:500 8.5px ${MONO};color:#8fa3b8">
        <span style="letter-spacing:.02em">${label}</span>
        <span style="color:#e9f0f8;text-align:right">${value}</span>
        <span style="display:block;height:4px;border-radius:99px;background:rgba(255,255,255,.09)">
          <span style="display:block;height:100%;width:${Math.round((value / Math.max(1, max)) * 100)}%;border-radius:99px;background:${color}"></span>
        </span>
      </div>`

    return {
      animationDuration: 900,
      grid: { left: 44, right: 18, top: 30, bottom: 30 },
      xAxis: {
        type: 'category',
        boundaryGap: false,
        data: windows.map((w) => w.label),
        axisLine: { lineStyle: { color: gridColor } },
        axisTick: { show: false },
        axisLabel: {
          color: axisColor,
          fontSize: 8.5,
          fontFamily: MONO,
          interval: labelInterval,
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
          const w = windows[index]
          const value = metricValue(w, metric)
          const prev = index > 0 ? metricValue(windows[index - 1], metric) : null
          const delta = prev == null ? null : value - prev
          const failed = liveCapture ? w.failedLogins > 0 : w.anomaly
          return `<div style="min-width:206px">
            <div style="display:flex;justify-content:space-between;gap:18px;font:500 8.5px ${MONO};letter-spacing:.12em;text-transform:uppercase;color:#7d8ea3">
              <span>${w.id} · ${w.label}</span>
              <span style="color:${failed ? '#ff9b74' : '#7fe0d2'}">${liveCapture ? (w.failedLogins ? 'Failed' : 'Granted') : w.anomaly ? 'Flagged' : 'Baseline'}</span>
            </div>
            ${liveCapture && w.account ? `<div style="margin-top:7px;font:500 9.5px ${MONO};color:#c9d8ea">${w.account}${w.sourceIp ? ` · ${w.sourceIp}` : ''}</div>` : ''}
            <div style="display:flex;align-items:baseline;gap:7px;margin-top:9px">
              <span style="font:600 26px/1 ${DISPLAY};letter-spacing:-.045em;color:#f4f8fc">${fmtMetric(metric, value)}</span>
              <span style="font:500 8.5px ${MONO};color:#8fa3b8">${liveCapture && metric === 'logins' ? 'failures so far' : meta.unit}</span>
              ${delta == null ? '' : `<span style="margin-left:auto;font:500 8.5px ${MONO};color:${delta > 0 ? '#ff9b74' : '#7fe0d2'}">${delta > 0 ? '+' : ''}${fmtMetric(metric, delta)}</span>`}
            </div>
            <div style="margin-top:11px;display:grid;gap:5px">
              ${featureBar(liveCapture ? 'Failures so far' : 'Failed logins', w.failuresSoFar ?? w.failedLogins, maxLogins, '#ff7a45')}
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
  }, [metric, dark, accent, navy, axisColor, gridColor, cardColor, meta, windows, liveCapture, maxLogins, maxIps, maxRps])

  const scrollToRegister = () => document.getElementById('an-register')?.scrollIntoView({ behavior: 'smooth', block: 'start' })

  const rows = onlyAnomalies ? flagged : windows

  const peakValue = metricValue(peak, metric)
  const peakLabel = liveCapture && metric === 'logins' ? 'peak cumulative failures' : meta.peakLabel
  const liveStatus =
    capture.status === 'live'
      ? capture.lastSync
        ? `live · synced ${timeAgo(capture.lastSync)}`
        : 'live · syncing'
      : capture.status === 'offline'
        ? 'portal offline · last capture'
        : 'live · connecting'

  const outcome = (w: LogWindow) => (w.failedLogins > 0 ? 'FAILED' : 'GRANTED')

  return (
    <div className="anomalies-page">
      <div className="an-shell">
        <header className="an-head">
          <div className="an-head-copy">
            <span className="an-eyebrow">Component 09 · Anomaly detection{liveCapture ? ' · live capture' : ''}</span>
            <h1>
              Behaviour that breaks <em>the baseline</em>
            </h1>
            <p>
              {liveCapture
                ? 'Every sign-in request from the Northwind decoy portal becomes a window here. Each failure is flagged and counted as it arrives; repeated attempts escalate the cumulative risk score.'
                : 'Auth logs are reduced to six-hour windows, compared against the learned baseline, and only deviations above the threshold surface with their evidence attached.'}
            </p>
          </div>
          <div className="an-head-side">
            <div className="an-pillrow">
              {liveCapture ? (
                <>
                  <span className="an-pill" style={capture.status === 'offline' ? { opacity: 0.75 } : undefined}>
                    <span className="an-dot" />
                    {liveStatus}
                  </span>
                  <span className="an-pill ghost">
                    {windows.length} attempts · {capture.failed} failed
                  </span>
                </>
              ) : (
                <>
                  <span className="an-pill">
                    <span className="an-dot" />
                    Live capture · waiting
                  </span>
                  <span className="an-pill ghost">Demo windows · {anomalyWindows.length}</span>
                </>
              )}
            </div>
            <button className="an-btn dark" onClick={scrollToRegister}>
              {liveCapture ? 'Attempt register' : 'Window register'} <ArrowRight size={13} />
            </button>
          </div>
        </header>

        <div className="an-grid">
          <section className="an-card an-gauge-card">
            <CardHead
              icon={<Gauge size={16} />}
              title={liveCapture ? 'Failed-request exposure' : 'Flag exposure'}
              sub={
                liveCapture
                  ? `${capture.failed} failed of ${windows.length} recorded ${windows.length === 1 ? 'attempt' : 'attempts'}`
                  : '18 windows across the demo week'
              }
              action={
                <button className="an-icon-btn" aria-label="About the gauge" onClick={scrollToRegister}>
                  <Info size={13} />
                </button>
              }
            />
            <div className="an-gauge-body">
              <div className="an-gauge-ring">
                <GaugeArc
                  total={windows.length}
                  segments={[
                    { count: flagged.length, color: 'var(--an-orange)' },
                    { count: watch.length, color: 'var(--an-watch)' },
                    { count: baseline.length, color: 'var(--an-slate-2)' },
                  ]}
                />
                <div className="an-gauge-center">
                  <div className="an-gauge-value">
                    {String(flagged.length).padStart(2, '0')}
                    <small>/{windows.length}</small>
                  </div>
                  <div className="an-gauge-label">{liveCapture ? 'failed requests' : 'flagged windows'}</div>
                </div>
              </div>
              <div className="an-gauge-legend">
                <span>
                  <i style={{ background: 'var(--an-orange)' }} /> {liveCapture ? 'Failed' : 'Flagged'} · {flagged.length}
                </span>
                <span>
                  <i style={{ background: 'var(--an-watch)' }} /> {liveCapture ? 'Elevated grant' : 'Watch'} · {watch.length}
                </span>
                <span>
                  <i style={{ background: 'var(--an-slate-2)' }} /> {liveCapture ? 'Clean grant' : 'Baseline'} · {baseline.length}
                </span>
              </div>
              <div className="an-split-stats">
                <div className="an-split-stat">
                  <Zap size={13} />
                  <b>{score2(Math.max(0, ...scores))}</b>
                  <span>peak score</span>
                </div>
                <div className="an-split-stat">
                  <ShieldAlert size={13} />
                  <b>{Math.round(flagRate * 100)}%</b>
                  <span>{liveCapture ? 'failure rate' : 'flag rate'}</span>
                </div>
                <div className="an-split-stat">
                  <Activity size={13} />
                  <b>{scores.length ? score2(median(scores)) : '0.00'}</b>
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
              sub={liveCapture ? 'One window per sign-in request · threshold held at 0.20' : 'Six-hour windows · threshold held at 0.20'}
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
                      {liveCapture && m.id === 'logins' ? 'Failures' : m.label}
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
                    <small>
                      {metric === 'score' ? '' : metric === 'logins' ? (liveCapture ? 'failures' : 'logins') : 'req/s'}
                    </small>
                  </div>
                  <div className="an-hero-label">
                    <span>{peakLabel}</span>
                    <span className="an-chip soft">{peak.label}</span>
                    {metric === 'score' && peakValue > THRESHOLD && (
                      <span className="an-chip alert">+{score2(peakValue - THRESHOLD)} over threshold</span>
                    )}
                    {liveCapture && peak.level && (
                      <span className={cx('an-chip', peak.level === 'LOW' ? 'soft' : 'alert')}>
                        {peak.level} · {peak.riskScore ?? 0}/100
                      </span>
                    )}
                    {!liveCapture && metric !== 'score' && peak.anomaly && <span className="an-chip alert">flagged window</span>}
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
                  <b>
                    {flagged.length} of {windows.length}
                  </b>
                  <span>{liveCapture ? 'requests flagged as failed' : 'windows above threshold'}</span>
                </div>
                <div className="an-hero-cell navy">
                  <b>{score2(THRESHOLD)}</b>
                  <span>fixed cut · auditable</span>
                </div>
                <div className="an-hero-cell">
                  <b>{scores.length ? score2(median(scores)) : '0.00'}</b>
                  <span>{liveCapture ? 'median score · full capture' : 'median score · full week'}</span>
                </div>
              </div>
            </div>
          </section>

          <section className="an-card an-mix-card">
            <CardHead
              icon={<BarChart3 size={16} />}
              tone="soft"
              title="Signal mix"
              sub={liveCapture ? 'Failed sign-ins by driver' : 'Failed logins by driver'}
              action={<span className="an-chip soft">{flaggedLoad} {liveCapture ? 'failed' : 'logins'}</span>}
            />
            <div className="an-mix-body">
              <div className="an-mix-rows">
                {mix.length === 0 && (
                  <div className="an-note">
                    <Info size={12} />
                    <span>No failed sign-ins in this capture yet. Fail a login on the decoy portal and it will appear here on the next poll.</span>
                  </div>
                )}
                {mix.map((item, index) => (
                  <div className="an-mix-row" key={item.id}>
                    <div className="an-mix-line">
                      <span>{item.label}</span>
                      <b>{((item.logins / Math.max(1, flaggedLoad)) * 100).toFixed(1)}%</b>
                    </div>
                    <div className="an-mix-bar">
                      <i
                        style={{
                          width: `${Math.max((item.logins / Math.max(1, flaggedLoad)) * 100, 3)}%`,
                          background: MIX_COLORS[index % MIX_COLORS.length],
                        }}
                      />
                    </div>
                    <div className="an-mix-meta">
                      <span>{item.id}</span>
                      <span>{item.logins} {liveCapture ? 'failed' : 'logins'}</span>
                    </div>
                  </div>
                ))}
              </div>

              <div className="an-compare">
                <div className="an-compare-head">
                  <b>{liveCapture ? 'Failed vs granted requests' : 'Flagged vs baseline load'}</b>
                  <span>{liveCapture ? 'attempts' : '6h windows'}</span>
                </div>
                <div className="an-compare-cols">
                  <div className="an-compare-col">
                    <div className="an-compare-track">
                      <div className="an-compare-fill orange" style={{ height: `${(flaggedLoad / Math.max(1, windows.length)) * 100}%` }} />
                    </div>
                    <div className="an-compare-val">
                      <b>{flaggedLoad}</b>
                      <span>failed</span>
                    </div>
                  </div>
                  <div className="an-compare-col">
                    <div className="an-compare-track">
                      <div className="an-compare-fill navy" style={{ height: `${(normalLoad / Math.max(1, windows.length)) * 100}%` }} />
                    </div>
                    <div className="an-compare-val">
                      <b>{normalLoad}</b>
                      <span>granted</span>
                    </div>
                  </div>
                </div>
                <div className="an-mix-cta">
                  <span className="an-chip soft">{flagged.length} {liveCapture ? 'failed requests' : 'windows carry the load'}</span>
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
              sub={liveCapture ? 'Flagged sign-ins, highest cumulative risk first' : 'Flagged windows, highest score first'}
              action={<span className="an-chip alert">needs review</span>}
            />
            <div className="an-queue-body">
              <div className="an-queue-head">
                <span>{liveCapture ? 'Attempt / driver' : 'Window / driver'}</span>
                <span>{liveCapture ? 'Hits' : 'Share'}</span>
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
                            <b>{w.account ?? w.label}</b>
                            <span>{liveCapture ? `${w.label} · ${w.reason}` : w.reason}</span>
                          </span>
                        </span>
                        <span className="an-queue-share">
                          {liveCapture ? `${w.failuresSoFar ?? 1} hit${(w.failuresSoFar ?? 1) === 1 ? '' : 's'}` : `${((w.failedLogins / Math.max(1, flaggedLoad)) * 100).toFixed(1)}%`}
                        </span>
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
            <CardHead
              icon={<Grid3X3 size={16} />}
              tone="soft"
              title="Feature print"
              sub={liveCapture ? 'Peak intensity per capture slice' : 'Peak intensity per day'}
            />
            <div className="an-print-body">
              <div className="an-print-hero">
                <div>
                  <div className="an-print-num">
                    {Math.round(flagRate * 100)}
                    <small>%</small>
                  </div>
                  <div className="an-print-note">
                    {liveCapture
                      ? `of ${windows.length} attempts flagged · ${printStats.length} capture slices`
                      : `of windows flagged across ${DAYS.length} days · ${flagged.length} of ${windows.length}`}
                  </div>
                </div>
              </div>

              <div className="an-print-grid">
                {printStats.map((day) => (
                  <div
                    className="an-print-col"
                    key={day.day}
                    title={`${day.day} · ${day.count} ${liveCapture ? 'attempts' : 'windows'} · ${day.flagged} flagged · peak ${day.logins} failures / ${day.ips} IPs / ${day.rps} rps`}
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
                  <h2 className="an-card-title">{liveCapture ? 'Attempt register' : 'Window register'}</h2>
                  <div className="an-card-sub">
                    {rows.length} {liveCapture ? 'sign-in requests' : 'windows'} · {flagged.length} flagged · evidence recorded per {liveCapture ? 'request' : 'window'}
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
                    {liveCapture ? 'All attempts' : 'All windows'}
                  </button>
                  <button
                    role="tab"
                    aria-selected={onlyAnomalies}
                    className={cx(onlyAnomalies && 'on')}
                    onClick={() => setOnlyAnomalies(true)}
                  >
                    {liveCapture ? 'Failed' : 'Flagged'}
                  </button>
                </div>
              </div>
            </div>
            <div className="an-register-scroll">
              <table className="an-table">
                <thead>
                  {liveCapture ? (
                    <tr>
                      <th>Attempt</th>
                      <th>Account</th>
                      <th>Source IP</th>
                      <th>Location</th>
                      <th>Outcome</th>
                      <th className="right">Risk</th>
                      <th>Finding</th>
                    </tr>
                  ) : (
                    <tr>
                      <th>Window</th>
                      <th className="right">Failed logins</th>
                      <th className="right">Distinct IPs</th>
                      <th className="right">RPS</th>
                      <th className="right">Country novelty</th>
                      <th className="right">Score</th>
                      <th>Finding</th>
                    </tr>
                  )}
                </thead>
                <tbody>
                  {rows.map((w) => {
                    const failed = w.failedLogins > 0
                    return (
                      <tr
                        key={w.id}
                        className={cx('clickable', failed && 'flagged')}
                        onClick={() => setSelected(w)}
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') setSelected(w)
                        }}
                      >
                        {liveCapture ? (
                          <>
                            <td>
                              <span className="an-cell-window">{w.label}</span>{' '}
                              <span className="an-cell-mono" style={{ color: 'var(--an-muted-2)' }}>
                                {w.id}
                              </span>
                            </td>
                            <td className="an-cell-mono">{w.account}</td>
                            <td className="an-cell-mono">{w.sourceIp}</td>
                            <td className="an-cell-mono">{w.country}</td>
                            <td>
                              <span className={cx('an-outcome', failed ? 'failed' : 'granted')}>
                                {outcome(w)}
                              </span>
                            </td>
                            <td className="right">
                              <span className={cx('an-cell-score', !failed && 'quiet')}>{w.riskScore ?? '—'}</span>
                              <span className="an-cell-mono" style={{ marginLeft: 6, color: 'var(--an-muted-2)' }}>
                                {w.level}
                              </span>
                            </td>
                            <td>
                              <span className={cx('an-finding', !failed && 'quiet')}>
                                {failed && <i />}
                                {failed ? w.reason : w.reason ?? 'within baseline'}
                              </span>
                            </td>
                          </>
                        ) : (
                          <>
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
                          </>
                        )}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <div className="an-table-foot">
              <span className="an-inline">
                <ShieldCheck size={12} />{' '}
                {liveCapture
                  ? 'Every request is ingested automatically from the Northwind portal; passwords are never stored or sent to Aegis.'
                  : 'Missing optional log fields are tolerated; missing timestamp or event type rejects the row.'}
              </span>
              <span className="an-mono">
                {liveCapture ? `n=${rows.length} · auto-fetch 2s` : `n=${rows.length} · scroll`}
              </span>
            </div>
          </section>

          <section className="an-card an-foot-card">
            <div className="an-foot-body">
              <div className="an-foot-stats">
                <div className="an-foot-label">
                  Layer B · statistics{' '}
                  <span className="an-chip soft">{liveCapture ? 'live capture' : 'demo windows'}</span>
                </div>
                <div className="an-foot-grid">
                  {[
                    { label: 'Mean score', value: scores.length ? stat2(mean(scores)) : '0.00' },
                    { label: 'Median', value: scores.length ? stat2(median(scores)) : '0.00' },
                    { label: 'p95', value: scores.length ? stat2(quantile(scores, 0.95)) : '0.00' },
                    { label: 'Dispersion σ', value: scores.length ? stat2(stdev(scores)) : '0.00' },
                    { label: liveCapture ? 'Failure rate' : 'Flag rate', value: `${(flagRate * 100).toFixed(1)}%` },
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
                  {(liveCapture
                    ? [
                        ['Ingest request', 'The portal writes JSON + CSV; Aegis polls every 2 seconds.'],
                        ['Build features', 'Failures, distinct IPs, RPS, geo novelty per attempt.'],
                        ['Score cumulative risk', 'Deterministic 0–100 score rebuilt after each request.'],
                        ['Flag failures', 'Every failed request is flagged; score sets the severity.'],
                      ]
                    : [
                        ['Reduce logs', 'Six-hour windows per destination asset.'],
                        ['Build features', 'Failures, distinct IPs, RPS, geo novelty.'],
                        ['Score isolation', 'Precomputed IsolationForest-aligned scores.'],
                        ['Apply threshold', 'Fixed 0.20 cut keeps the demo auditable.'],
                      ]
                  ).map(([title, body], index) => (
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
                    {liveCapture
                      ? 'Windows are derived directly from the live portal capture. The score is deterministic, so the same request sequence always yields the same verdict.'
                      : 'These window-level scores are demonstration data, not a claim that a model detected these events in a live environment.'}
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
              overline={`${selected.id} · ${
                selected.kind === 'live'
                  ? selected.failedLogins > 0
                    ? 'FAILED REQUEST'
                    : 'ACCESS GRANTED'
                  : selected.anomaly
                    ? 'FLAGGED'
                    : 'WITHIN BASELINE'
              }`}
              title={selected.kind === 'live' && selected.account ? selected.account : selected.label}
              onClose={() => setSelected(null)}
              meta={
                selected.kind === 'live' ? (
                  <span className="inline-flex" style={{ gap: 8 }}>
                    <span className="badge upload">LIVE CAPTURE</span>
                    {selected.level && (
                      <span className={`badge ${selected.level.toLowerCase()}`}>
                        {selected.level} · {selected.riskScore ?? 0}/100
                      </span>
                    )}
                  </span>
                ) : (
                  <span className="inline-flex" style={{ gap: 8 }}>
                    <span className="badge upload">USER UPLOAD</span>
                    <span className="badge simulated">demo windows</span>
                  </span>
                )
              }
            />
            <div className="drawer-body">
              <div className="drawer-section">
                <p className="an-drawer-note">
                  {selected.kind === 'live'
                    ? selected.failedLogins > 0
                      ? `Failed sign-in for ${selected.account} from ${selected.sourceIp} (${selected.country}). ${selected.reason}. The request is flagged and counted even when the cumulative score is still below the HIGH band.`
                      : `Sign-in granted for ${selected.account} from ${selected.sourceIp} (${selected.country}). ${selected.reason}.`
                    : selected.anomaly
                      ? selected.reason
                      : 'This window sits inside the learned baseline. No alert was raised.'}
                </p>
              </div>
              <div className="drawer-section">
                <h3>Features</h3>
                <div className="provenance-list">
                  {selected.kind === 'live' && (
                    <>
                      <div className="provenance-row">
                        <span className="check">✓</span>
                        <span>Outcome</span>
                        <span className="time">{outcome(selected)}</span>
                      </div>
                      <div className="provenance-row">
                        <span className="check">✓</span>
                        <span>Account</span>
                        <span className="time">{selected.account}</span>
                      </div>
                      <div className="provenance-row">
                        <span className="check">✓</span>
                        <span>Source IP</span>
                        <span className="time">{selected.sourceIp}</span>
                      </div>
                      <div className="provenance-row">
                        <span className="check">✓</span>
                        <span>Location</span>
                        <span className="time">{selected.country}</span>
                      </div>
                      <div className="provenance-row">
                        <span className="check">✓</span>
                        <span>Requests so far</span>
                        <span className="time">{selected.attemptsSoFar ?? 1}</span>
                      </div>
                      <div className="provenance-row">
                        <span className="check">✓</span>
                        <span>Failures so far</span>
                        <span className="time">{selected.failuresSoFar ?? selected.failedLogins}</span>
                      </div>
                      <div className="provenance-row">
                        <span className="check">✓</span>
                        <span>Cumulative risk score</span>
                        <span className="time">{selected.riskScore ?? 0}/100</span>
                      </div>
                    </>
                  )}
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
                    {selected.kind === 'live'
                      ? selected.level === 'CRITICAL' || selected.level === 'HIGH'
                        ? `Revoke sessions for ${selected.account}, force a password reset and re-enrol MFA. Block ${selected.sourceIp} while the capture is reviewed.`
                        : selected.level === 'MEDIUM'
                          ? `Rate-limit ${selected.sourceIp} and require MFA for ${selected.account} on the next sign-in.`
                          : selected.failedLogins > 0
                            ? 'No containment yet. The failure is preserved in the capture; re-check if the account or source repeats.'
                            : 'No action. This request sits inside the capture baseline.'
                      : selected.anomaly
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
