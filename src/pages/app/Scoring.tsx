import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { Chart, axisStyle } from '../../components/Chart'
import {
  Activity,
  ArrowRight,
  BarChart3,
  Check,
  ChevronDown,
  Crosshair,
  Gauge,
  Info,
  Layers,
  ShieldAlert,
  SlidersHorizontal,
  Sparkles,
  TrendingUp,
  Zap,
} from '../../components/Icons'
import { useTheme } from '../../lib/store'
import { fmtPct, fmtScore } from '../../lib/format'
import { mean, quantile, stdev } from '../../lib/stats'
import { scoreAlert, WEIGHTS, levelFromScore, relevanceLabel } from '../../lib/scoring'
import { ML_BANDS, MODEL_CARD, topFeatureImportance, FEATURE_LABELS } from '../../lib/ml'
import { useLiveActiveAlerts, useLiveAlerts, useLiveCounts, useLiveMl } from '../../lib/liveData'
import { useScopeInfo } from '../../lib/dataScope'
import { hexA } from '../../lib/colors'
import type { Alert, Criticality, RelevanceStatus, RiskLevel } from '../../lib/types'
import './assets.css'
import './scoring.css'

const LEVEL_ORDER: RiskLevel[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']

const LEVEL_BANDS: Record<RiskLevel, string> = {
  CRITICAL: '≥ 85',
  HIGH: '65',
  MEDIUM: '40',
  LOW: '< 40',
}

const LADDER_BANDS: Record<RiskLevel, string> = {
  CRITICAL: '≥ 85',
  HIGH: '65 – 84.9',
  MEDIUM: '40 – 64.9',
  LOW: '< 40',
}

type FactorKey =
  | 'severity_points'
  | 'exploit_points'
  | 'kev_points'
  | 'criticality_points'
  | 'exposure_points'
  | 'relevance_points'

const FACTORS: { key: FactorKey; label: string; max: number; tone: string; detail: string }[] = [
  { key: 'severity_points', label: 'Severity', max: WEIGHTS.severity, tone: 'var(--xp-orange)', detail: '(CVSS ÷ 10) × 25' },
  { key: 'exploit_points', label: 'Exploitation', max: WEIGHTS.epss, tone: 'var(--xp-orange-2)', detail: 'EPSS × 100 × 0.25' },
  { key: 'kev_points', label: 'Known exploited', max: WEIGHTS.kev, tone: 'var(--xp-navy)', detail: 'flat 10 when listed in KEV' },
  { key: 'criticality_points', label: 'Asset criticality', max: WEIGHTS.criticality, tone: 'var(--xp-level-high)', detail: 'HIGH 25 · MEDIUM 15 · LOW 5' },
  { key: 'exposure_points', label: 'Exposure', max: WEIGHTS.exposure, tone: 'var(--xp-green)', detail: 'flat 5 when internet-facing' },
  { key: 'relevance_points', label: 'Relevance', max: WEIGHTS.relevance, tone: 'var(--xp-muted)', detail: 'MATCHED 10 · VERSION_UNKNOWN 5' },
]

const WEIGHT_ROWS = [
  { factor: 'Severity', weight: WEIGHTS.severity, detail: '(CVSS ÷ 10) × 25', tone: 'var(--xp-orange)' },
  { factor: 'Exploitation', weight: WEIGHTS.epss, detail: 'EPSS × 100 × 0.25', tone: 'var(--xp-orange-2)' },
  { factor: 'Known exploited', weight: WEIGHTS.kev, detail: 'flat 10 when listed in KEV', tone: 'var(--xp-navy)' },
  { factor: 'Asset criticality', weight: WEIGHTS.criticality, detail: 'HIGH 25 · MEDIUM 15 · LOW 5', tone: 'var(--xp-level-high)' },
  { factor: 'Exposure', weight: WEIGHTS.exposure, detail: 'flat 5 when internet-facing', tone: 'var(--xp-green)' },
  { factor: 'Relevance', weight: WEIGHTS.relevance, detail: 'MATCHED 10 · VERSION_UNKNOWN 5', tone: 'var(--xp-muted)' },
]

const arcPlot = (radius: number, deg: number) => {
  const rad = (deg * Math.PI) / 180
  return { x: 140 + radius * Math.cos(rad), y: 140 + radius * Math.sin(rad) }
}

const arcPath = (radius: number, start: number, end: number) => {
  const s = arcPlot(radius, start)
  const e = arcPlot(radius, end)
  return `M ${s.x.toFixed(2)} ${s.y.toFixed(2)} A ${radius} ${radius} 0 0 1 ${e.x.toFixed(2)} ${e.y.toFixed(2)}`
}

/* ---------- small pieces ---------- */

function CardHead({
  icon,
  title,
  sub,
  action,
  tone,
}: {
  icon: ReactNode
  title: string
  sub: string
  action?: ReactNode
  tone?: 'orange'
}) {
  return (
    <header className="xp-card-head sc-card-head">
      <div className="xp-card-titlewrap">
        <span className={tone === 'orange' ? 'xp-card-icon orange' : 'xp-card-icon'}>{icon}</span>
        <div style={{ minWidth: 0 }}>
          <div className="xp-card-title">{title}</div>
          <div className="xp-card-sub">{sub}</div>
        </div>
      </div>
      {action}
    </header>
  )
}

function MiniStat({
  icon,
  value,
  label,
  ink,
  soft,
  rule,
}: {
  icon: ReactNode
  value: ReactNode
  label: string
  ink: string
  soft: string
  rule: string
}) {
  return (
    <div className="xp-mini">
      <span className="xp-mini-ico" style={{ '--mini-ink': ink, '--mini-soft': soft } as CSSProperties}>
        {icon}
      </span>
      <div className="xp-mini-val">{value}</div>
      <div className="xp-mini-label">{label}</div>
      <span className="xp-mini-rule" style={{ '--mini-rule': rule } as CSSProperties} />
    </div>
  )
}

function ScoreArc({
  value,
  level,
  suppressed,
  tones,
}: {
  value: number
  level: RiskLevel
  suppressed: boolean
  tones: Record<RiskLevel, string>
}) {
  const clamped = Math.max(0, Math.min(100, value))
  const angle = 180 + (clamped / 100) * 180
  const [drawn, setDrawn] = useState(false)

  useEffect(() => {
    const t = window.setTimeout(() => setDrawn(true), 120)
    return () => window.clearTimeout(t)
  }, [])

  return (
    <div className="xp-gauge-ring sc-gauge-ring">
      <svg viewBox="0 0 280 164" role="img" aria-label={`Computed risk score ${fmtScore(value)}`}>
        <path
          d={arcPath(100, 180, 360)}
          fill="none"
          strokeWidth={22}
          strokeLinecap="round"
          className="xp-gauge-track"
        />
        {LEVEL_ORDER.slice()
          .reverse()
          .map((l) => {
            const bounds: Record<RiskLevel, [number, number]> = {
              LOW: [0, 40],
              MEDIUM: [40, 65],
              HIGH: [65, 85],
              CRITICAL: [85, 100],
            }
            const [from, to] = bounds[l]
            const active = !suppressed && level === l
            return (
              <path
                key={l}
                d={arcPath(100, 180 + from * 1.8, 180 + to * 1.8)}
                fill="none"
                strokeWidth={22}
                strokeLinecap="butt"
                pathLength={100}
                strokeDasharray="100"
                strokeDashoffset={drawn ? 0 : 100}
                className="sc-gauge-seg"
                style={{
                  stroke: tones[l],
                  opacity: active ? 0.2 : 0.09,
                  transitionDelay: `${LEVEL_ORDER.length * 60 - LEVEL_ORDER.indexOf(l) * 60}ms`,
                }}
              />
            )
          })}
        {[40, 65, 85].map((mark) => {
          const p1 = arcPlot(82, 180 + mark * 1.8)
          const p2 = arcPlot(118, 180 + mark * 1.8)
          return (
            <line
              key={mark}
              x1={p1.x}
              y1={p1.y}
              x2={p2.x}
              y2={p2.y}
              className="sc-gauge-tick"
              strokeWidth={1.5}
            />
          )
        })}
        <path
          d={arcPath(100, 180, Math.max(180.001, angle))}
          fill="none"
          strokeWidth={22}
          strokeLinecap="round"
          pathLength={100}
          strokeDasharray="100"
          strokeDashoffset={drawn ? 100 - clamped : 100}
          className="sc-gauge-value"
          style={{ stroke: suppressed ? 'var(--xp-muted-2)' : tones[level] }}
        />
        <g
          className="sc-gauge-marker"
          style={{
            transform: `rotate(${angle}deg)`,
            transformOrigin: '140px 140px',
            opacity: drawn ? 1 : 0,
          }}
        >
          <circle
            cx={240}
            cy={140}
            r={5.6}
            className="sc-gauge-knob"
            style={{ stroke: suppressed ? 'var(--xp-muted-2)' : tones[level] }}
          />
        </g>
      </svg>
      <div className="xp-gauge-center">
        <span className="xp-gauge-num" style={suppressed ? { color: 'var(--xp-muted-2)' } : undefined}>
          {fmtScore(value)}
        </span>
        <span className="xp-gauge-label">
          {suppressed ? 'gated · not ranked' : `${level.toLowerCase()} · capped at 100`}
        </span>
      </div>
    </div>
  )
}

/* ---------- page ---------- */

export default function Scoring() {
  const alerts = useLiveAlerts()
  if (!alerts.length) return <ScoringEmpty />
  return <ScoringWorkspace alerts={alerts} />
}

function ScoringEmpty() {
  const navigate = useNavigate()
  const scopeInfo = useScopeInfo()
  return (
    <div className="exposure-page scoring-page">
      <div className="xp-shell">
        <header className="xp-head">
          <div className="xp-head-copy">
            <span className="xp-eyebrow">Component 03 · Risk scoring</span>
            <h1>
              A formula you can <em>audit</em>.
            </h1>
            <p>Nothing in {scopeInfo.label} correlates to the threat catalog yet, so there is no score to derive.</p>
          </div>
          <div className="xp-head-side">
            <div className="xp-actions">
              <button type="button" className="xp-btn xp-btn-light" onClick={() => navigate('/app/uploads')}>
                Data Input Hub <ArrowRight size={13} />
              </button>
              <button type="button" className="xp-btn xp-btn-dark" onClick={() => navigate('/app/alerts')}>
                Alert queue <ArrowRight size={13} />
              </button>
            </div>
          </div>
        </header>
        <section className="xp-card" style={{ padding: 34 }}>
          <div className="xp-empty">
            <span className="xp-empty-icon">
              <Gauge size={16} />
            </span>
            <strong>No alerts to score</strong>
            <span>Add software versions to the dataset so the relevance gate has something to match, or switch back to live feeds.</span>
          </div>
        </section>
      </div>
    </div>
  )
}

function ScoringWorkspace({ alerts }: { alerts: Alert[] }) {
  const theme = useTheme((s) => s.theme)
  const navigate = useNavigate()
  const activeAlerts = useLiveActiveAlerts()
  const counts = useLiveCounts()
  const liveMl = useLiveMl()
  const base = alerts[0]
  const [selectedId, setSelectedId] = useState(base.id)
  const assetAlert = alerts.find((a) => a.id === selectedId) ?? base

  useEffect(() => {
    if (!alerts.some((a) => a.id === selectedId)) setSelectedId(base.id)
  }, [alerts, selectedId, base.id])

  const [cvss, setCvss] = useState(assetAlert.cve.cvss ?? 0)
  const [epss, setEpss] = useState(assetAlert.cve.epss ?? 0)
  const [kev, setKev] = useState(assetAlert.cve.kev)
  const [criticality, setCriticality] = useState<Criticality>(assetAlert.asset.criticality)
  const [internetFacing, setInternetFacing] = useState(assetAlert.asset.internetFacing)
  const [relevance, setRelevance] = useState<RelevanceStatus>(assetAlert.relevance)

  useEffect(() => {
    setCvss(assetAlert.cve.cvss ?? 0)
    setEpss(assetAlert.cve.epss ?? 0)
    setKev(assetAlert.cve.kev)
    setCriticality(assetAlert.asset.criticality)
    setInternetFacing(assetAlert.asset.internetFacing)
    setRelevance(assetAlert.relevance)
  }, [assetAlert])

  const result = useMemo(
    () =>
      scoreAlert({
        cve: { ...assetAlert.cve, cvss, epss, kev },
        criticality,
        internetFacing,
        relevance,
      }),
    [assetAlert.cve, cvss, epss, kev, criticality, internetFacing, relevance],
  )

  const tones = useMemo<Record<RiskLevel, string>>(
    () =>
      theme === 'dark'
        ? { CRITICAL: '#ff6a36', HIGH: '#a9c2da', MEDIUM: '#6f8499', LOW: '#465b70' }
        : { CRITICAL: '#ff5a1f', HIGH: '#14263e', MEDIUM: '#8d99a8', LOW: '#c0c7d0' },
    [theme],
  )

  const histogramOption = useMemo(() => {
    const bins = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]
    const data = bins.slice(0, -1).map((lo, i) => {
      const hi = bins[i + 1]
      return activeAlerts.filter((a) => a.score >= lo && (i === bins.length - 2 ? a.score <= hi : a.score < hi)).length
    })
    const axBase = axisStyle(theme, { split: false })
    const ax = {
      ...axBase,
      axisLabel: { ...axBase.axisLabel, color: theme === 'dark' ? '#90a4b8' : '#8b877f' },
      axisLine: { lineStyle: { color: theme === 'dark' ? 'rgba(233,239,246,.14)' : 'rgba(16,29,45,.14)' } },
    }
    return {
      grid: { left: 30, right: 10, top: 24, bottom: 26 },
      xAxis: {
        type: 'category',
        data: bins.slice(0, -1).map((b, i) => `${b}–${bins[i + 1]}`),
        ...ax,
        axisLabel: { ...ax.axisLabel, interval: 0, fontSize: 7.5, margin: 8 },
      },
      yAxis: {
        type: 'value',
        ...ax,
        minInterval: 1,
        splitLine: {
          lineStyle: {
            color: theme === 'dark' ? 'rgba(233,239,246,.07)' : 'rgba(16,29,45,.06)',
            type: 'dashed' as const,
          },
        },
      },
      tooltip: {
        trigger: 'axis',
        backgroundColor: theme === 'dark' ? 'rgba(15,26,38,.97)' : '#14263e',
        borderColor: 'transparent',
        textStyle: { color: '#f5f1e9' },
      },
      series: [
        {
          type: 'bar',
          data: data.map((v, i) => ({
            value: v,
            itemStyle: {
              color: [
                tones.LOW,
                tones.LOW,
                tones.LOW,
                tones.LOW,
                tones.MEDIUM,
                tones.MEDIUM,
                tones.HIGH,
                tones.HIGH,
                tones.CRITICAL,
                tones.CRITICAL,
              ][i],
              borderRadius: [4, 4, 0, 0],
              opacity: 0.9,
            },
          })),
          barWidth: '62%',
          emphasis: { itemStyle: { opacity: 1 } },
          animationDelay: (idx: number) => idx * 55,
        },
      ],
    }
  }, [theme, activeAlerts, tones])

  const scatterOption = useMemo(() => {
    const axBase = axisStyle(theme, { split: false })
    const ax = {
      ...axBase,
      axisLabel: { ...axBase.axisLabel, color: theme === 'dark' ? '#90a4b8' : '#8b877f' },
      axisLine: { lineStyle: { color: theme === 'dark' ? 'rgba(233,239,246,.14)' : 'rgba(16,29,45,.14)' } },
    }
    return {
      grid: { left: 34, right: 16, top: 26, bottom: 38 },
      xAxis: {
        type: 'value',
        min: 0,
        max: 10,
        name: 'CVSS base',
        ...ax,
        nameLocation: 'middle',
        nameGap: 22,
        nameTextStyle: { color: theme === 'dark' ? '#90a4b8' : '#8b877f', fontSize: 9 },
        splitLine: {
          show: true,
          lineStyle: {
            color: theme === 'dark' ? 'rgba(233,239,246,.06)' : 'rgba(16,29,45,.05)',
            type: 'dashed' as const,
          },
        },
      },
      yAxis: {
        type: 'value',
        min: 0,
        max: 100,
        name: 'Risk score',
        ...ax,
        nameGap: 26,
        nameTextStyle: { color: theme === 'dark' ? '#90a4b8' : '#8b877f', fontSize: 9 },
        splitLine: {
          lineStyle: {
            color: theme === 'dark' ? 'rgba(233,239,246,.06)' : 'rgba(16,29,45,.05)',
            type: 'dashed' as const,
          },
        },
      },
      tooltip: {
        formatter: (p: any) =>
          `${p.data[3]}<br/>CVSS ${p.data[0]} · score ${p.data[1]}<br/>EPSS ${(p.data[2] * 100).toFixed(1)}%`,
        backgroundColor: theme === 'dark' ? 'rgba(15,26,38,.97)' : '#14263e',
        borderColor: 'transparent',
        textStyle: { color: '#f5f1e9' },
      },
      series: [
        {
          type: 'scatter',
          data: activeAlerts.map((a) => [
            a.cve.cvss ?? 0,
            a.score,
            a.cve.epss ?? 0,
            `${a.cve.id} · ${a.asset.name}`,
            a.level,
          ]),
          symbolSize: (val: any) => 7 + (val[2] ?? 0) * 26,
          itemStyle: {
            color: (p: any) => hexA(tones[(p.data[4] as RiskLevel) ?? 'MEDIUM'], 0.78),
            borderColor: theme === 'dark' ? 'rgba(7,14,23,.75)' : 'rgba(255,253,249,.92)',
            borderWidth: 1.4,
          },
          label: { show: false },
          emphasis: { scale: 1.4 },
        },
      ],
    }
  }, [theme, activeAlerts, tones])

  const scores = activeAlerts.map((a) => a.score)
  const cvssRanked = [...activeAlerts].sort((a, b) => (b.cve.cvss ?? 0) - (a.cve.cvss ?? 0))
  const modelRanked = [...activeAlerts].sort((a, b) => b.score - a.score)
  const moved = modelRanked
    .map((a, i) => ({ a, model: i + 1, naive: cvssRanked.findIndex((x) => x.id === a.id) + 1 }))
    .filter((r) => r.model !== r.naive)
    .slice(0, 5)

  const corr = useMemo(() => {
    const xs = activeAlerts.map((a) => a.cve.cvss ?? 0)
    const ys = activeAlerts.map((a) => a.score)
    const mx = mean(xs)
    const my = mean(ys)
    const cov = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0)
    const sx = Math.sqrt(xs.reduce((s, x) => s + (x - mx) ** 2, 0))
    const sy = Math.sqrt(ys.reduce((s, y) => s + (y - my) ** 2, 0))
    return sx && sy ? cov / (sx * sy) : 0
  }, [activeAlerts])

  const scoresByLevel: Record<RiskLevel, number> = {
    CRITICAL: counts.critical,
    HIGH: counts.high,
    MEDIUM: counts.medium,
    LOW: counts.low,
  }

  const focusBuilder = () => {
    const node = document.getElementById('sc-builder')
    node?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div className="exposure-page scoring-page">
      <div className="xp-shell">
        <header className="xp-head">
          <div className="xp-head-copy">
            <span className="xp-eyebrow">Component 03 · Risk scoring</span>
            <h1>
              A formula you can <em>audit</em>.
            </h1>
            <p>
              Move any input and watch the score recompute. The deterministic core owns the number; AI only writes the
              prose around it.
            </p>
          </div>
          <div className="xp-head-side">
            <div className="xp-org">
              <span className="xp-org-avatar">v1</span>
              <span className="xp-org-copy">
                <b>Deterministic core</b>
                <small>6 factors · cap 100 · round 1dp</small>
              </span>
            </div>
            <div className="xp-actions">
              <button type="button" className="xp-btn xp-btn-dark" onClick={focusBuilder}>
                <SlidersHorizontal size={13} /> Score an alert
              </button>
              <button type="button" className="xp-btn xp-btn-light" onClick={() => navigate('/app/alerts')}>
                Alert queue <ArrowRight size={13} />
              </button>
            </div>
          </div>
        </header>

        <div className="xp-grid sc-grid">
          <section className="xp-card sc-gauge-card" aria-label="Computed score">
            <CardHead
              icon={<Gauge size={16} />}
              title="Computed score"
              sub={`${assetAlert.cve.id} · ${assetAlert.asset.name}`}
              tone="orange"
              action={
                <span
                  className="sc-level"
                  style={{
                    color: result.suppressed ? 'var(--xp-muted)' : tones[result.level],
                    borderColor: hexA(result.suppressed ? '#8b877f' : tones[result.level], 0.42),
                    background: hexA(result.suppressed ? '#8b877f' : tones[result.level], 0.08),
                  }}
                >
                  {result.suppressed ? 'SUPPRESSED' : result.level}
                </span>
              }
            />
            <ScoreArc value={result.score} level={result.level} suppressed={result.suppressed} tones={tones} />
            <div className="sc-gauge-note">
              {result.suppressed
                ? `would have scored ${fmtScore(result.wouldHaveScored ?? 0)}`
                : `raw ${result.breakdown.total_raw.toFixed(1)} → capped ${result.score.toFixed(1)}`}
            </div>
            <div className="xp-gauge-legend sc-gauge-legend">
              {LEVEL_ORDER.map((l) => (
                <span
                  key={l}
                  className={!result.suppressed && result.level === l ? 'on' : undefined}
                  style={!result.suppressed && result.level === l ? { color: 'var(--xp-ink)' } : undefined}
                >
                  <i style={{ background: tones[l] }} />
                  <b>{LEVEL_BANDS[l]}</b> {l.toLowerCase()}
                </span>
              ))}
            </div>
            <div className="xp-gauge-band">
              <MiniStat
                icon={<TrendingUp size={13} />}
                value={result.breakdown.total_raw.toFixed(1)}
                label="Raw before cap"
                ink="#c9521c"
                soft="#ffeadf"
                rule="var(--xp-orange)"
              />
              <MiniStat
                icon={<ShieldAlert size={13} />}
                value={result.suppressed ? 'gated' : fmtScore(result.score)}
                label={result.suppressed ? 'Below threshold' : 'Ranked score'}
                ink="#31465f"
                soft="#e9eef4"
                rule="var(--xp-level-high)"
              />
              <MiniStat
                icon={<Check size={13} />}
                value={result.dataIncomplete ? '5 / 6' : '6 / 6'}
                label="Factors fed"
                ink="#2f8f62"
                soft="#e6f2eb"
                rule="var(--xp-green)"
              />
            </div>
          </section>

          <section className="xp-card sc-builder-card" id="sc-builder" aria-label="Score builder">
            <CardHead
              icon={<SlidersHorizontal size={16} />}
              title="Score builder"
              sub="Recompute from any alert's real inputs"
              tone="orange"
              action={
                <span className="xp-pill sc-live-pill">
                  <Zap size={11} /> live
                </span>
              }
            />
            <div className="sc-builder-body">
              <div className="sc-controls">
                <div className="sc-field">
                  <label htmlFor="score-alert">Start from alert</label>
                  <span className="xp-selectwrap sc-selectwrap">
                    <select
                      id="score-alert"
                      className="xp-select"
                      value={selectedId}
                      onChange={(e) => setSelectedId(e.target.value)}
                    >
                      {alerts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.cve.id} · {a.asset.name}
                        </option>
                      ))}
                    </select>
                    <ChevronDown size={12} />
                  </span>
                </div>

                <div className="sc-field">
                  <label htmlFor="range-cvss">
                    CVSS base <b>{cvss.toFixed(1)}</b>
                    <span>severity {((cvss / 10) * 25).toFixed(1)} pts</span>
                  </label>
                  <input
                    id="range-cvss"
                    className="sc-range"
                    type="range"
                    min={0}
                    max={10}
                    step={0.1}
                    value={cvss}
                    onChange={(e) => setCvss(Number(e.target.value))}
                    style={{ '--pct': `${cvss * 10}%` } as CSSProperties}
                  />
                </div>

                <div className="sc-field">
                  <label htmlFor="range-epss">
                    EPSS <b>{fmtPct(epss)}</b>
                    <span>exploitation {(epss * 25).toFixed(1)} pts</span>
                  </label>
                  <input
                    id="range-epss"
                    className="sc-range"
                    type="range"
                    min={0}
                    max={1}
                    step={0.001}
                    value={epss}
                    onChange={(e) => setEpss(Number(e.target.value))}
                    style={{ '--pct': `${epss * 100}%` } as CSSProperties}
                  />
                </div>

                <div className="sc-field-pair">
                  <div className="sc-field">
                    <label htmlFor="score-criticality">Asset criticality</label>
                    <span className="xp-selectwrap sc-selectwrap">
                      <select
                        id="score-criticality"
                        className="xp-select"
                        value={criticality}
                        onChange={(e) => setCriticality(e.target.value as Criticality)}
                      >
                        <option value="HIGH">HIGH · 25 pts</option>
                        <option value="MEDIUM">MEDIUM · 15 pts</option>
                        <option value="LOW">LOW · 5 pts</option>
                      </select>
                      <ChevronDown size={12} />
                    </span>
                  </div>

                  <div className="sc-field">
                    <label htmlFor="score-relevance">Relevance status</label>
                    <span className="xp-selectwrap sc-selectwrap">
                      <select
                        id="score-relevance"
                        className="xp-select"
                        value={relevance}
                        onChange={(e) => setRelevance(e.target.value as RelevanceStatus)}
                      >
                        {(['MATCHED', 'VERSION_UNKNOWN', 'NOT_AFFECTED', 'PRODUCT_ABSENT'] as RelevanceStatus[]).map(
                          (r) => (
                            <option key={r} value={r}>
                              {relevanceLabel[r]}
                            </option>
                          ),
                        )}
                      </select>
                      <ChevronDown size={12} />
                    </span>
                  </div>
                </div>

                <div className="sc-toggles">
                  <button
                    type="button"
                    className={kev ? 'sc-toggle on kev' : 'sc-toggle'}
                    onClick={() => setKev((v) => !v)}
                    aria-pressed={kev}
                  >
                    <span className="sc-toggle-dot">{kev && <Check size={9} strokeWidth={3} />}</span>
                    KEV listed <b>{kev ? '+10' : '+0'}</b>
                  </button>
                  <button
                    type="button"
                    className={internetFacing ? 'sc-toggle on face' : 'sc-toggle'}
                    onClick={() => setInternetFacing((v) => !v)}
                    aria-pressed={internetFacing}
                  >
                    <span className="sc-toggle-dot">{internetFacing && <Check size={9} strokeWidth={3} />}</span>
                    Internet-facing <b>{internetFacing ? '+5' : '+0'}</b>
                  </button>
                </div>

                {result.dataIncomplete && (
                  <p className="sc-warning">
                    <Info size={12} />
                    Incomplete data: a CVSS or EPSS value is missing. The UI keeps the gap visible.
                  </p>
                )}
              </div>

              <div className="sc-breakdown">
                <div className="sc-breakdown-head">
                  <span>Contribution</span>
                  <span className="mono">sum {result.breakdown.total_raw.toFixed(1)}</span>
                </div>
                <div className="sc-total">
                  <div className="sc-total-copy">
                    <strong>{fmtScore(result.breakdown.total_raw)}</strong>
                    <span>of 100 before the cap</span>
                  </div>
                  <div className="sc-total-track">
                    <i style={{ width: `${Math.min(100, result.breakdown.total_raw)}%` }} />
                  </div>
                </div>
                <div className="sc-factors">
                  {FACTORS.map((f, i) => {
                    const value = result.breakdown[f.key] ?? 0
                    return (
                      <div className="sc-factor" key={f.key} title={f.detail}>
                        <span className="sc-factor-top">
                          <span className="sc-factor-name">
                            <i style={{ background: f.tone }} />
                            {f.label}
                          </span>
                          <span className="mono">
                            {value.toFixed(1)}
                            <small> / {f.max}</small>
                          </span>
                        </span>
                        <span className="sc-factor-track">
                          <i
                            style={
                              {
                                width: `${Math.max(0, Math.min(100, (value / f.max) * 100))}%`,
                                background: f.tone,
                                '--i': i,
                              } as CSSProperties
                            }
                          />
                        </span>
                      </div>
                    )
                  })}
                </div>
                <div className="sc-breakdown-foot">
                  <span className={result.suppressed ? 'sc-gate on' : 'sc-gate'}>
                    <i /> {result.suppressed ? 'gated by relevance' : 'relevance matched'}
                  </span>
                  <button type="button" className="sc-open" onClick={() => navigate(`/app/alerts?alert=${assetAlert.id}`)}>
                    Open in queue <ArrowRight size={11} />
                  </button>
                </div>
              </div>
            </div>
          </section>

          <section className="xp-card sc-weights-card" aria-label="Factor reference">
            <CardHead
              icon={<Layers size={16} />}
              title="Factor reference"
              sub="Weights sum to 100 before the cap"
            />
            <div className="sc-weights">
              {WEIGHT_ROWS.map((r, i) => (
                <div className="sc-weight" key={r.factor}>
                  <div className="sc-weight-top">
                    <span className="sc-weight-name">
                      <i style={{ background: r.tone }} />
                      {r.factor}
                    </span>
                    <span className="mono">{r.weight}</span>
                  </div>
                  <span className="sc-weight-track">
                    <i style={{ width: `${r.weight}%`, background: r.tone, '--i': i } as CSSProperties} />
                  </span>
                  <small>{r.detail}</small>
                </div>
              ))}
            </div>
            <div className="sc-card-foot">
              <span>KEV floor raises MATCHED alerts to ≥ HIGH</span>
              <span className="mono">total 100</span>
            </div>
          </section>

          <section className="xp-card sc-chart-card" aria-label="Score distribution">
            <CardHead
              icon={<BarChart3 size={16} />}
              title="Score distribution"
              sub={`${activeAlerts.length} active demo alerts · 10-point bins`}
            />
            <div className="sc-chart">
              <Chart option={histogramOption} height={226} />
            </div>
            <div className="xp-chart-foot sc-chart-foot">
              <div className="xp-chart-stat" style={{ '--xp-tone': 'var(--xp-orange)' } as CSSProperties}>
                <span className="xp-chart-stat-label">Mean score</span>
                <strong>
                  {fmtScore(mean(scores))} <small>avg</small>
                </strong>
              </div>
              <div className="xp-chart-stat" style={{ '--xp-tone': 'var(--xp-level-high)' } as CSSProperties}>
                <span className="xp-chart-stat-label">Median</span>
                <strong>
                  {fmtScore(quantile(scores, 0.5))} <small>p50</small>
                </strong>
              </div>
              <div className="xp-chart-stat" style={{ '--xp-tone': 'var(--xp-green)' } as CSSProperties}>
                <span className="xp-chart-stat-label">p95</span>
                <strong>
                  {fmtScore(quantile(scores, 0.95))} <small>σ {fmtScore(stdev(scores))}</small>
                </strong>
              </div>
            </div>
          </section>

          <section className="xp-card sc-ladder-card" aria-label="Threshold ladder">
            <CardHead
              icon={<TrendingUp size={16} />}
              title="Threshold ladder"
              sub="Where the current score sits"
            />
            <div className="sc-ladder">
              {LEVEL_ORDER.map((level) => {
                const active = !result.suppressed && levelFromScore(result.score) === level
                return (
                  <div
                    className={active ? 'sc-ladder-row on' : 'sc-ladder-row'}
                    key={level}
                    style={
                      active
                        ? ({ '--ladder': tones[level], borderColor: hexA(tones[level], 0.45) } as CSSProperties)
                        : undefined
                    }
                  >
                    <span className="sc-ladder-name">
                      <i style={{ background: tones[level] }} />
                      <strong>{level}</strong>
                    </span>
                    <span className="mono">{LADDER_BANDS[level]}</span>
                    <span className="sc-ladder-count mono">{scoresByLevel[level]}</span>
                    {active && <span className="sc-ladder-chip">current</span>}
                  </div>
                )
              })}
            </div>
            <p className="sc-note">
              KEV floors can raise the label above the band implied by the numeric score. That precedence is
              deliberate and tested.
            </p>
          </section>

          <section className="xp-card sc-scatter-card" aria-label="CVSS versus computed risk">
            <CardHead
              icon={<Crosshair size={16} />}
              title="CVSS vs computed risk"
              sub="Bubble area = EPSS · ordering is not severity alone"
            />
            <div className="sc-chart">
              <Chart option={scatterOption} height={236} />
            </div>
            <div className="xp-chart-foot sc-chart-foot">
              <div className="xp-chart-stat" style={{ '--xp-tone': 'var(--xp-orange)' } as CSSProperties}>
                <span className="xp-chart-stat-label">Alerts plotted</span>
                <strong>{activeAlerts.length}</strong>
              </div>
              <div className="xp-chart-stat" style={{ '--xp-tone': 'var(--xp-level-high)' } as CSSProperties}>
                <span className="xp-chart-stat-label">CVSS ↔ score</span>
                <strong>
                  {corr.toFixed(2)} <small>pearson</small>
                </strong>
              </div>
              <div className="xp-chart-stat" style={{ '--xp-tone': 'var(--xp-green)' } as CSSProperties}>
                <span className="xp-chart-stat-label">Factor spread</span>
                <strong>
                  {fmtScore(stdev(scores))} <small>σ</small>
                </strong>
              </div>
            </div>
          </section>

          <section className="xp-card sc-ml-card" aria-label="XGBoost second opinion">
            <CardHead
              icon={<Sparkles size={16} />}
              title="XGBoost second opinion"
              sub={`${MODEL_CARD.dataset.rows.toLocaleString('en-US')} live rows · ${MODEL_CARD.rounds} trees · exported and scored in the browser`}
              tone="orange"
              action={<span className="xp-pill sc-trained">trained · {MODEL_CARD.version}</span>}
            />
            <div className="sc-ml-body">
              <div className="sc-ml-left">
                <div className="sc-metrics">
                  {[
                    { label: 'Test AUC', value: MODEL_CARD.test.auc.toFixed(3), note: 'held-out 18%' },
                    { label: 'CV AUC', value: MODEL_CARD.cv.auc.toFixed(3), note: `${MODEL_CARD.cv.folds}-fold` },
                    { label: 'Log loss', value: MODEL_CARD.test.logloss.toFixed(3), note: 'test' },
                    { label: 'Brier', value: MODEL_CARD.test.brier.toFixed(3), note: 'calibration' },
                    {
                      label: 'Rounds',
                      value: String(MODEL_CARD.rounds),
                      note: `early stop ${MODEL_CARD.params.earlyStoppingRounds}`,
                    },
                    {
                      label: 'Positive rate',
                      value: `${MODEL_CARD.dataset.positiveRate.toFixed(2)}%`,
                      note: 'KEV label',
                    },
                  ].map((m) => (
                    <div className="sc-metric" key={m.label}>
                      <span className="mono">{m.label}</span>
                      <strong>{m.value}</strong>
                      <small>{m.note}</small>
                    </div>
                  ))}
                </div>

                <div className="sc-importance">
                  <div className="sc-importance-head">
                    <span>Feature gain</span>
                    <span className="mono">share of total</span>
                  </div>
                  {topFeatureImportance.map((f, i) => (
                    <div className="sc-importance-row" key={f.feature}>
                      <span>{FEATURE_LABELS[f.feature] ?? f.feature}</span>
                      <span className="sc-importance-track" aria-hidden="true">
                        <i style={{ width: `${Math.max(2, f.share)}%`, '--i': i } as CSSProperties} />
                      </span>
                      <small className="mono">{f.share.toFixed(1)}%</small>
                    </div>
                  ))}
                </div>
              </div>

              <div className="sc-ml-right">
                <div className="sc-live-head">
                  <span className="mono">Live predictions · active alerts</span>
                  <span className="mono">
                    mean {(liveMl.portfolio.mean * 100).toFixed(0)}% · elevated {liveMl.portfolio.elevated}
                  </span>
                </div>
                <div className="sc-live-list">
                  {liveMl.active.slice(0, 6).map(({ alert, prediction }) => (
                    <div className="sc-live-row" key={alert.id}>
                      <div className="sc-live-id">
                        <span className="mono">{alert.cve.id}</span>
                        <small>{alert.asset.name}</small>
                      </div>
                      <span className="sc-live-track" aria-hidden="true">
                        <i
                          style={
                            {
                              width: `${Math.max(2, prediction.probability * 100)}%`,
                              background:
                                prediction.band === 'ELEVATED'
                                  ? tones.CRITICAL
                                  : prediction.band === 'WATCH'
                                    ? 'var(--xp-orange-2)'
                                    : 'var(--xp-green)',
                            } as CSSProperties
                          }
                        />
                      </span>
                      <span className={`sc-band ${prediction.band.toLowerCase()}`}>
                        {(prediction.probability * 100).toFixed(1)}%
                      </span>
                    </div>
                  ))}
                </div>
                <p className="sc-note sc-ml-note">
                  {MODEL_CARD.disclaimer} Bands: ELEVATED ≥ {(ML_BANDS.elevated * 100).toFixed(1)}%, WATCH ≥{' '}
                  {(ML_BANDS.watch * 100).toFixed(1)}%. The deterministic score still decides the queue; the model is a
                  cross-check.
                </p>
              </div>
            </div>
            <div className="sc-card-foot">
              <span className="mono">train: python3 ml/train_live_xgb.py · export parity ≤ 1e-05 vs booster.predict</span>
              <span className="mono">Fitted on live NVD, EPSS and KEV · KEV label excluded</span>
            </div>
          </section>

          <section className="xp-card sc-moves-card" aria-label="Rank moves">
            <CardHead
              icon={<ArrowRight size={16} />}
              title="What the model reorders"
              sub="Largest moves against a CVSS-only queue"
            />
            <div className="sc-moves">
              {moved.map(({ a, model, naive }) => {
                const delta = naive - model
                return (
                  <button
                    type="button"
                    className="sc-move"
                    key={a.id}
                    onClick={() => navigate(`/app/alerts?alert=${a.id}`)}
                    title={`${a.cve.title} — open in the queue`}
                  >
                    <span className="sc-move-id">
                      <strong className="mono">{a.cve.id}</strong>
                      <small>{a.asset.name}</small>
                    </span>
                    <span className="sc-move-rank mono">
                      #{naive} <ArrowRight size={10} /> #{model}
                    </span>
                    <span className={delta > 0 ? 'sc-delta up' : 'sc-delta down'}>
                      {delta > 0 ? '▲' : '▼'} {Math.abs(delta)}
                    </span>
                  </button>
                )
              })}
            </div>
            <p className="sc-note">Six-factor ordering vs CVSS alone · not the XGBoost prior.</p>
          </section>

          <section className="xp-card sc-example-card" aria-label="Worked example">
            <CardHead
              icon={<Check size={16} />}
              title="Worked example · Log4Shell"
              sub="Unit-test fixture reproduced live on the HR portal"
            />
            <div className="sc-example">
              {[
                { label: 'Severity', value: '25.0', detail: 'CVSS 10.0 → (10 ÷ 10) × 25' },
                { label: 'Exploitation', value: '24.4', detail: 'EPSS 0.9755 × 25 = 24.3875' },
                { label: 'KEV', value: '10.0', detail: 'listed in CISA KEV' },
                { label: 'Asset', value: '25.0', detail: 'criticality HIGH' },
                { label: 'Exposure', value: '5.0', detail: 'internet-facing' },
                { label: 'Relevance', value: '10.0', detail: 'version in range' },
              ].map((c) => (
                <div className="sc-example-cell" key={c.label}>
                  <span className="mono">{c.label}</span>
                  <strong>{c.value}</strong>
                  <small>{c.detail}</small>
                </div>
              ))}
              <div className="sc-example-cell total">
                <span className="mono">total</span>
                <strong>99.4</strong>
                <small>CRITICAL · shown to one decimal</small>
              </div>
            </div>
          </section>

          <section className="xp-card sc-stats-card" aria-label="Score summary">
            <CardHead
              icon={<Activity size={16} />}
              title="Summary statistics"
              sub={`${scores.length} ranked alerts · suppressed candidates excluded`}
            />
            <div className="sc-stats">
              {[
                { name: 'Mean score', value: fmtScore(mean(scores)), formula: 'mean(score_i)' },
                { name: 'Median', value: fmtScore(quantile(scores, 0.5)), formula: '50th percentile' },
                {
                  name: 'p95',
                  value: fmtScore(quantile(scores, 0.95)),
                  formula: '95th percentile, linear interpolation',
                },
                { name: 'Dispersion', value: `σ ${fmtScore(stdev(scores))}`, formula: 'sample standard deviation' },
                {
                  name: 'Suppressed',
                  value: String(counts.suppressed),
                  formula: `of ${counts.total} candidates · excluded from these n`,
                },
              ].map((s) => (
                <div className="sc-stat" key={s.name}>
                  <span className="mono">{s.name}</span>
                  <strong>{s.value}</strong>
                  <small>{s.formula}</small>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
