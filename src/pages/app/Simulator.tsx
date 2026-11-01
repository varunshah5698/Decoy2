import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { Chart, axisStyle, chartTokens } from '../../components/Chart'
import {
  Activity,
  ArrowRight,
  BarChart3,
  Bug,
  Crosshair,
  Gauge,
  Grid3X3,
  Info,
  KeyRound,
  Layers,
  Network,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Swords,
  Zap,
} from '../../components/Icons'
import { useCorrelationModel } from '../../lib/correlation'
import { useLivePosture } from '../../lib/liveData'
import { useTheme } from '../../lib/store'
import { clamp, cx, fmtScore, round } from '../../lib/format'
import { hexA, LEVEL_COLORS } from '../../lib/colors'
import {
  MODEL_FACTORS,
  buildSoftwareTargets,
  decodeVector,
  simulate,
  type ControlToggle,
  type Dataset,
  type SimClass,
  type SimEvent,
} from '../../lib/vulnSim'
import type { Criticality } from '../../lib/types'
import './simulator.css'

const REPLAY_SECONDS = 11
const SPEEDS = [0.5, 1, 2, 4]
type VerdictFilter = 'all' | SimEvent['verdict']

const pct = (value: number) => `${Math.round(value * 100)}%`
const hrs = (value: number) => (Number.isFinite(value) ? (value < 10 ? value.toFixed(1) : String(Math.round(value))) : '—')
const toneOf = (weight: number) => (weight >= 0.8 ? 'crit' : weight >= 0.4 ? 'med' : 'low')
const heatLevel = (value: number) => (value <= 0 ? 0 : value < 0.2 ? 1 : value < 0.45 ? 2 : value < 0.7 ? 3 : value < 0.9 ? 4 : 5)
const blocksOf = (value: number, max: number) => (value <= 0 ? 0 : Math.max(1, Math.round((value / max) * 10)))
const acronym = (tactic: string) =>
  tactic
    .split(/[\s&.]+/)
    .filter(Boolean)
    .map((word) => word[0])
    .join('')
    .toUpperCase()
    .slice(0, 3)

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
    <div className="sim-card-head">
      <div className="sim-titlewrap">
        <span className={cx('sim-card-icon', tone)}>{icon}</span>
        <div>
          <h2 className="sim-card-title">{title}</h2>
          <div className="sim-card-sub">{sub}</div>
        </div>
      </div>
      {action}
    </div>
  )
}

function BreachRing({ segments, total }: { segments: { key: string; count: number; color: string }[]; total: number }) {
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
        stroke="var(--sim-line)"
        strokeWidth={i % 5 === 0 ? 1.4 : 0.9}
      />
    )
  })

  return (
    <svg viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${total} modelled paths, coloured by severity`}>
      <circle
        cx={center}
        cy={center}
        r={radius}
        fill="none"
        stroke="var(--sim-track)"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={`${(circum * sweep) / 360} ${circum}`}
        transform={`rotate(135 ${center} ${center})`}
      />
      {ticks}
      {segments.map((segment) => {
        const degrees = (segment.count / Math.max(1, total)) * sweep
        const length = (circum * degrees) / 360
        const rotation = 135 + travelled + ((gap / circum) * 360) / 2
        travelled += degrees
        return (
          <circle
            key={segment.key}
            className="sim-gauge-seg"
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
        stroke="var(--sim-line-2)"
        strokeWidth={1}
        strokeDasharray={`${(circum * sweep) / 360} ${circum}`}
        transform={`rotate(135 ${center} ${center})`}
      />
    </svg>
  )
}

const Idle = ({ title, note }: { title: string; note: string }) => (
  <div className="sim-idle">
    <b>{title}</b>
    <span>{note}</span>
  </div>
)

export default function Simulator() {
  const theme = useTheme((s) => s.theme)
  const reduceMotion = useMemo(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    [],
  )
  const model = useCorrelationModel()
  const livePosture = useLivePosture()

  const data: Dataset = useMemo(() => ({ cves: model.cves, alerts: model.alerts, assets: model.assets }), [model])
  const targets = useMemo(() => buildSoftwareTargets(data), [data])

  const [softwareKey, setSoftwareKey] = useState(targets[0]?.key ?? '')
  const target = targets.find((item) => item.key === softwareKey) ?? targets[0]
  const [assetId, setAssetId] = useState(target.hosts[0]?.asset.id ?? '')
  const host = target.hosts.find((item) => item.asset.id === assetId) ?? target.hosts[0]
  const asset = host.asset
  const [version, setVersion] = useState(host.version)
  const [patched, setPatched] = useState(false)
  const [exposure, setExposure] = useState<boolean | null>(null)
  const [criticality, setCriticality] = useState<Criticality | 'baseline'>('baseline')
  const [trials, setTrials] = useState(200)
  const [seed, setSeed] = useState(7)
  const [enabledControls, setEnabledControls] = useState<string[]>([])
  const [selectedKey, setSelectedKey] = useState<string | null>(null)

  const internetFacing = exposure ?? asset.internetFacing
  const effectiveCrit = criticality === 'baseline' ? asset.criticality : criticality

  const overrides = useMemo(
    () => ({ patched, internetFacing, criticality: effectiveCrit }),
    [patched, internetFacing, effectiveCrit],
  )

  const sim = useMemo(
    () => simulate({ softwareKey: target.key, assetId: asset.id, version, overrides, enabledControls, trials, seed }, data),
    [data, target.key, asset.id, version, overrides, enabledControls, trials, seed],
  )

  const selected: SimClass | null = sim.classes.find((cls) => cls.key === selectedKey) ?? sim.classes[0] ?? null

  /* ---- the breach clock ---- */
  const [clock, setClock] = useState(0)
  const [playing, setPlaying] = useState(true)
  const [speed, setSpeed] = useState(1)
  const signature = [
    target.key,
    asset.id,
    version,
    patched,
    internetFacing,
    effectiveCrit,
    [...enabledControls].sort().join('|'),
    trials,
    seed,
  ].join('::')

  // signature is deliberately the only dependency: a new scenario is a new run
  useEffect(() => {
    if (reduceMotion) {
      setClock(sim.windowHours)
      setPlaying(false)
    } else {
      setClock(0)
      setPlaying(true)
    }
  }, [signature, reduceMotion, sim.windowHours])

  useEffect(() => {
    if (!playing) return
    let raf = 0
    let last = performance.now()
    const rate = sim.windowHours / REPLAY_SECONDS
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      setClock((prev) => Math.min(sim.windowHours, prev + dt * rate * speed))
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, speed, sim.windowHours])

  useEffect(() => {
    if (playing && clock >= sim.windowHours) setPlaying(false)
  }, [clock, playing, sim.windowHours])

  const play = () => {
    if (clock >= sim.windowHours) setClock(0)
    setPlaying(true)
  }
  const restart = () => {
    setClock(0)
    setPlaying(true)
  }
  const scrub = (value: number) => {
    setPlaying(false)
    setClock(clamp(value, 0, sim.windowHours))
  }

  /* ---- progressive reveal ---- */
  const revealedCount = useMemo(() => {
    let n = 0
    for (const event of sim.events) if (event.at <= clock) n += 1
    return n
  }, [sim.events, clock])

  const [filter, setFilter] = useState<VerdictFilter>('all')
  const [openId, setOpenId] = useState<string | null>(null)
  const registerRef = useRef<HTMLDivElement | null>(null)

  const rows = useMemo(() => {
    const visible = sim.events.slice(0, revealedCount).filter((event) => filter === 'all' || event.verdict === filter)
    return visible.map((event, index) => ({ event, index, last: index === visible.length - 1 }))
  }, [sim.events, revealedCount, filter])

  useEffect(() => {
    if (playing && registerRef.current) registerRef.current.scrollTop = registerRef.current.scrollHeight
  }, [revealedCount, playing])

  const stageState = useMemo(() => {
    if (!selected) return []
    const byIndex = new Map<number, SimEvent>()
    for (const event of sim.events) if (event.classKey === selected.key) byIndex.set(event.stageIndex, event)
    return selected.chain.map((stage) => byIndex.get(stage.index))
  }, [selected, sim.events])

  const passed = stageState.filter((event) => event && clock >= event.at).length - 1
  const railPct = selected ? (clamp((passed + 1) / selected.chain.length, 0, 1) * 100).toFixed(1) : '0'

  const cdfAt = (hour: number) => {
    let value = 0
    for (const point of sim.aggregate.cdf) if (hour >= point.hour) value = point.cumulative
    return value
  }

  /* ---- charts ---- */
  const markStep = Math.max(1, sim.windowHours / 60)
  const markHour = Math.round(clock / markStep) * markStep

  const cdfOption = useMemo(() => {
    const t = chartTokens(theme)
    const ax = axisStyle(theme)
    const accent = t.dark ? '#ff6a36' : '#ff5a1f'
    return {
      grid: { left: 38, right: 16, top: 16, bottom: 24 },
      xAxis: {
        type: 'value',
        min: 0,
        max: sim.windowHours,
        interval: Math.ceil(sim.windowHours / 6),
        ...ax,
        splitLine: { show: false },
        axisLabel: { ...ax.axisLabel, formatter: (v: number) => `${v}h` },
      },
      yAxis: { type: 'value', min: 0, max: 100, interval: 25, ...ax },
      tooltip: { trigger: 'axis', valueFormatter: (v: number) => `${v}% breached` },
      series: [
        {
          name: 'Cumulative breach probability',
          type: 'line',
          smooth: true,
          symbol: 'circle',
          symbolSize: 5,
          showSymbol: false,
          lineStyle: { color: accent, width: 2 },
          itemStyle: { color: accent },
          areaStyle: { color: hexA(accent, t.dark ? 0.18 : 0.14) },
          data: sim.aggregate.cdf.map((point) => [point.hour, Math.round(point.cumulative * 100)]),
          markLine: {
            silent: true,
            symbol: 'none',
            data: [{ xAxis: markHour }],
            lineStyle: { color: t.amber, width: 1.5, type: 'solid' },
            label: { formatter: `clock ${Math.round(markHour)}h`, color: t.amber, fontSize: 9, fontFamily: 'inherit' },
          },
        },
      ],
    }
  }, [theme, sim, markHour])

  /* ---- derived board numbers ---- */
  const aggregate = sim.aggregate
  const severityCounts = useMemo(() => {
    const tally: Record<string, number> = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 }
    for (const cls of sim.classes) tally[cls.severity] = (tally[cls.severity] ?? 0) + 1
    return tally
  }, [sim.classes])

  const ringSegments = (['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const)
    .filter((level) => severityCounts[level] > 0)
    .map((level) => ({ key: level, count: severityCounts[level], color: LEVEL_COLORS[level] }))

  const maxBin = Math.max(1, ...aggregate.histogram.map((bin) => bin.count))
  const cdfNow = cdfAt(clock)
  const breachesByNow = Math.round(cdfNow * sim.trials)
  const meanStageP = useMemo(() => {
    if (!sim.events.length) return 0
    return sim.events.reduce((sum, event) => sum + event.probability, 0) / sim.events.length
  }, [sim.events])

  const topSensitivity = useMemo(() => {
    const scored = [...sim.sensitivity]
    scored.sort((a, b) => a.delta - b.delta || b.rateOff - a.rateOff)
    const meaningful = scored.filter((row) => row.delta !== 0)
    return (meaningful.length ? meaningful : scored).slice(0, 4)
  }, [sim.sensitivity])

  const impactCells = useMemo(() => {
    if (!selected) return []
    const readings = decodeVector(selected.vector)
    const noteAt = (key: string, fallback: string) => readings.find((metric) => metric.key === key)?.note ?? fallback
    return [
      {
        key: 'c',
        label: 'Confidentiality',
        value: pct(selected.impact.c),
        note: noteAt('C', 'how much of the data set becomes readable'),
        weight: selected.impact.c,
      },
      {
        key: 'i',
        label: 'Integrity',
        value: pct(selected.impact.i),
        note: noteAt('I', 'how freely records can be rewritten'),
        weight: selected.impact.i,
      },
      {
        key: 'a',
        label: 'Availability',
        value: pct(selected.impact.a),
        note: noteAt('A', 'how much of the service is lost'),
        weight: selected.impact.a,
      },
      {
        key: 'stop',
        label: 'Fails most often at',
        value: selected.blockedMostAt,
        note: `counted across ${sim.trials} seeded trials of this chain`,
        weight: selected.likelihood,
      },
      {
        key: 'lift',
        label: 'Alert lift forecast',
        value: `+${round(aggregate.expectedBreaches, 2)}`,
        note: `${round(aggregate.additionalCritical, 2)} critical · ${round(aggregate.additionalHigh, 2)} high, summed from path rates`,
        weight: clamp(aggregate.expectedBreaches / Math.max(1, sim.classes.length), 0, 1),
      },
      {
        key: 'scope',
        label: 'Blast radius',
        value: `${sim.spread.length} hosts`,
        note: aggregate.expectedHops > 0 ? `${round(aggregate.expectedHops, 2)} hops expected beyond this host` : 'no lateral path projected',
        weight: clamp(sim.spread.length / 8, 0, 1),
      },
    ]
  }, [selected, sim.trials, sim.spread.length, aggregate])

  const whatifRows = useMemo(
    () => [...sim.whatif.rows].sort((a, b) => Math.abs(b.scenario - b.baseline) - Math.abs(a.scenario - a.baseline)).slice(0, 5),
    [sim.whatif.rows],
  )

  const toggleControl = (control: ControlToggle) =>
    setEnabledControls((prev) => (prev.includes(control.id) ? prev.filter((id) => id !== control.id) : [...prev, control.id]))

  const pickSoftware = (key: string) => {
    const next = targets.find((item) => item.key === key) ?? targets[0]
    setSoftwareKey(next.key)
    setAssetId(next.hosts[0].asset.id)
    setVersion(next.hosts[0].version)
    setExposure(null)
    setEnabledControls([])
    setSelectedKey(null)
  }

  const pickHost = (id: string) => {
    const next = target.hosts.find((item) => item.asset.id === id) ?? target.hosts[0]
    setAssetId(next.asset.id)
    setVersion(next.version)
    setExposure(null)
  }

  const resetAll = () => {
    setPatched(false)
    setExposure(null)
    setCriticality('baseline')
    setEnabledControls([])
    setTrials(200)
    setSeed(7)
  }

  const registerCard = useRef<HTMLElement | null>(null)
  const footCard = useRef<HTMLElement | null>(null)
  const jumpTo = (node: HTMLElement | null) =>
    node?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' })

  const versionChoices = useMemo(() => {
    const fixes = target.cves.map((cve) => cve.fixVersion).filter(Boolean)
    return [...new Set([host.version, ...target.versions, ...fixes])].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  }, [target, host.version])

  const overrideSummary = [
    patched ? 'patched' : 'unpatched',
    internetFacing ? 'internet-facing' : 'internal only',
    `${effectiveCrit} criticality`,
    enabledControls.length ? `${enabledControls.length} gate${enabledControls.length > 1 ? 's' : ''} armed` : 'no gates armed',
  ].join(' · ')

  const readings = selected ? decodeVector(selected.vector) : []

  return (
    <div className="simulator-page">
      <div className="sim-shell">
        <header className="sim-head">
          <div className="sim-head-copy">
            <span className="sim-eyebrow">Component 10 · What-if simulator</span>
            <h1>
              Pick a package, then run the <em>breach clock</em>
            </h1>
            <p>
              Choose software on an asset and this board answers three things: which attack paths it actually opens, how each
              one unfolds stage by stage, and what else falls. Every probability is computed from the seeded CVSS vectors, EPSS
              scores, KEV flags, affected version ranges and ATT&amp;CK profiles — replayed as a seeded Monte Carlo run you can
              play, pause and scrub. Nothing here is stored, and nothing is written back.
            </p>
          </div>
          <div className="sim-head-side">
            <div className="sim-pillrow">
              <span className="sim-pill">
                <span className="sim-dot" />
                {sim.target.vendor} {sim.target.product} {sim.version}
              </span>
              <span className="sim-pill ghost">{sim.assetLabel}</span>
            </div>
            <div className="sim-pillrow">
              <span className="sim-pill">{sim.trials} trials · seed {sim.seed}</span>
              <span className="sim-pill ghost">Simulated demo</span>
            </div>
            <button className="sim-btn dark" onClick={() => jumpTo(registerCard.current)}>
              Event register <ArrowRight size={13} />
            </button>
          </div>
        </header>

        <div className="sim-grid">
          {/* ---------------- scenario controls ---------------- */}
          <section className="sim-card sim-controls-card">
            <CardHead
              icon={<SlidersHorizontal size={16} />}
              tone="orange"
              title="Scenario controls"
              sub="One package, one host, then the levers"
              action={
                <button className="sim-icon-btn" onClick={resetAll} aria-label="Reset every override">
                  <RefreshCw size={13} />
                </button>
              }
            />
            <div className="sim-controls-body">
              <div className="sim-field">
                <label className="sim-field-label" htmlFor="sim-software">
                  Software package
                </label>
                <select id="sim-software" className="sim-select" value={sim.target.key} onChange={(e) => pickSoftware(e.target.value)}>
                  {targets.map((item) => (
                    <option key={item.key} value={item.key}>
                      {item.vendor} {item.product} · {item.cves.length} CVEs · {item.hosts.length} hosts
                    </option>
                  ))}
                </select>
                <span className="sim-field-hint">
                  max CVSS {sim.target.maxCvss.toFixed(1)} · max EPSS {pct(sim.target.maxEpss)} · {sim.target.kevCount} KEV ·{' '}
                  {sim.target.activeAlerts} live alerts
                </span>
              </div>

              <div className="sim-field-row">
                <div className="sim-field">
                  <label className="sim-field-label" htmlFor="sim-host">
                    Host
                  </label>
                  <select id="sim-host" className="sim-select" value={asset.id} onChange={(e) => pickHost(e.target.value)}>
                    {target.hosts.map((item) => (
                      <option key={item.asset.id} value={item.asset.id}>
                        {item.asset.name} · {item.asset.criticality}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="sim-field">
                  <label className="sim-field-label" htmlFor="sim-version">
                    Installed version
                  </label>
                  <select id="sim-version" className="sim-select" value={version} onChange={(e) => setVersion(e.target.value)}>
                    {versionChoices.map((item) => (
                      <option key={item} value={item}>
                        {item}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <span className="sim-field-hint">
                stored inventory says {host.version}; version relevance is decided against each CVE affected range
              </span>

              <div className="sim-ctl-group">
                <span className="sim-ctl-head">Posture overrides</span>
                <div className="sim-toggle-row">
                  <span>Assume the package is patched</span>
                  <button
                    className={cx('sim-switch', patched && 'on')}
                    onClick={() => setPatched((value) => !value)}
                    aria-pressed={patched}
                    aria-label="Assume the package is patched"
                  >
                    <i />
                  </button>
                </div>
                <div className="sim-toggle-row">
                  <span>Internet-facing{exposure == null ? ' (as stored)' : ' (override)'}</span>
                  <button
                    className={cx('sim-switch', internetFacing && 'on')}
                    onClick={() => setExposure(internetFacing ? false : true)}
                    aria-pressed={internetFacing}
                    aria-label="Internet-facing"
                  >
                    <i />
                  </button>
                </div>
                <div className="sim-toggle-row">
                  <span>Criticality</span>
                  <select
                    className="sim-select"
                    style={{ width: 150, height: 30 }}
                    value={criticality}
                    onChange={(e) => setCriticality(e.target.value as Criticality | 'baseline')}
                    aria-label="Criticality override"
                  >
                    <option value="baseline">Baseline · {asset.criticality}</option>
                    <option value="HIGH">HIGH</option>
                    <option value="MEDIUM">MEDIUM</option>
                    <option value="LOW">LOW</option>
                  </select>
                </div>
              </div>

              <div className="sim-ctl-group">
                <span className="sim-ctl-head">Monte Carlo run</span>
                <div className="sim-field-row">
                  <div className="sim-field">
                    <label className="sim-field-label" htmlFor="sim-trials">
                      Trials per path
                    </label>
                    <input
                      id="sim-trials"
                      className="sim-number"
                      type="number"
                      min={40}
                      max={2000}
                      step={20}
                      value={trials}
                      onChange={(e) => {
                        const next = Number(e.target.value)
                        if (Number.isFinite(next)) setTrials(clamp(Math.round(next), 40, 2000))
                      }}
                    />
                  </div>
                  <div className="sim-field">
                    <label className="sim-field-label" htmlFor="sim-seed">
                      Seed
                    </label>
                    <input
                      id="sim-seed"
                      className="sim-number"
                      type="number"
                      min={0}
                      max={99999}
                      value={seed}
                      onChange={(e) => {
                        const next = Number(e.target.value)
                        if (Number.isFinite(next)) setSeed(clamp(Math.round(next), 0, 99999))
                      }}
                    />
                  </div>
                </div>
              </div>

              <div className="sim-ctl-group">
                <div className="sim-inline" style={{ width: '100%', justifyContent: 'space-between' }}>
                  <span className="sim-ctl-head">Gates on {selected ? selected.name : 'this path'}</span>
                  <span className="sim-inline">
                    <button className="sim-mini-btn" onClick={() => setEnabledControls(selected ? selected.controls.map((c) => c.id) : [])}>
                      Arm all
                    </button>
                    <button className="sim-mini-btn" onClick={() => setEnabledControls([])}>
                      Clear
                    </button>
                  </span>
                </div>
                {selected ? (
                  selected.controls.map((control) => {
                    const on = enabledControls.includes(control.id)
                    return (
                      <div className="sim-toggle-row" key={control.id}>
                        <span>
                          {control.label}{' '}
                          <span className="sim-cell-mono" style={{ color: 'var(--sim-muted)' }}>
                            · {control.team} · ×{control.multiplier}
                          </span>
                        </span>
                        <button
                          className={cx('sim-switch', on && 'on')}
                          onClick={() => toggleControl(control)}
                          aria-pressed={on}
                          aria-label={`Arm ${control.label}`}
                        >
                          <i />
                        </button>
                      </div>
                    )
                  })
                ) : (
                  <div className="sim-toggle-row">
                    <span>No modelled path to gate</span>
                  </div>
                )}
              </div>

              <div className="sim-note">
                <Info size={13} />
                <span>
                  These switches re-run the model in the browser. Stored alerts, assets and CVE records stay exactly as seeded —
                  the same overrides are echoed in the queue overlay card, which is also view-only.
                </span>
              </div>
            </div>
          </section>

          {/* ---------------- severity gauge ---------------- */}
          <section className="sim-card sim-gauge-card">
            <CardHead
              icon={<Gauge size={16} />}
              title="Paths in play"
              sub={`${sim.classes.length} modelled · ${sim.ruledOut.length} ruled out`}
              action={
                <button className="sim-icon-btn" onClick={() => jumpTo(footCard.current)} aria-label="Jump to the method notes">
                  <Info size={13} />
                </button>
              }
            />
            <div className="sim-gauge-body">
              <div className="sim-gauge-ring">
                <BreachRing segments={ringSegments} total={sim.classes.length} />
                <div className="sim-gauge-center">
                  <div className="sim-gauge-value">
                    {Math.round(aggregate.breachRate * 100)}
                    <small>%</small>
                  </div>
                  <div className="sim-gauge-label">≥ 1 path completes</div>
                </div>
              </div>
              <div className="sim-gauge-legend">
                {(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const).map((level) => (
                  <span key={level}>
                    <i style={{ background: LEVEL_COLORS[level] }} /> {level} {severityCounts[level] ?? 0}
                  </span>
                ))}
              </div>
              <div className="sim-share">
                <div className="sim-share-line">
                  <span>
                    <i /> Highest path
                  </span>
                  <b>{aggregate.worstClass ? `${pct(aggregate.worstClass.likelihood)}` : '—'}</b>
                </div>
                <div className="sim-share-bar">
                  <span className="sim-share-fill" style={{ width: `${(aggregate.worstClass?.likelihood ?? 0) * 100}%` }} />
                </div>
                <div className="sim-share-meta">
                  {aggregate.worstClass ? aggregate.worstClass.name : 'no path'} · {aggregate.expectedBreaches.toFixed(2)} paths
                  expected
                </div>
              </div>
            </div>
          </section>

          {/* ---------------- hero: time to first breach ---------------- */}
          <section className="sim-card sim-hero-card">
            <CardHead
              icon={<Activity size={16} />}
              tone="orange"
              title="Hours to first breach"
              sub="Joint across every modelled path, same seeds"
              action={<span className="sim-chip">{pct(aggregate.breachRate)} joint</span>}
            />
            <div className="sim-hero-body">
              <div className="sim-hero-top">
                <div className="sim-hero-figure">
                  <div className="sim-hero-num">
                    {hrs(aggregate.quantiles.p50)}
                    <small>hours p50</small>
                  </div>
                  <div className="sim-hero-label">
                    p10 <span>{hrs(aggregate.quantiles.p10)}h</span> · mean <span>{hrs(aggregate.quantiles.mean)}h</span> · p90{' '}
                    <span>{hrs(aggregate.quantiles.p90)}h</span>
                  </div>
                </div>
                <div className="sim-share" style={{ flex: '1 1 200px', maxWidth: 260 }}>
                  <div className="sim-share-line">
                    <span>
                      <i /> Breached by the clock
                    </span>
                    <b>{pct(cdfNow)}</b>
                  </div>
                  <div className="sim-share-bar">
                    <span className="sim-share-fill" style={{ width: `${cdfNow * 100}%` }} />
                  </div>
                  <div className="sim-share-line">
                    <span>
                      <i style={{ background: 'var(--sim-bar-2)' }} /> Still ahead
                    </span>
                    <b>{pct(1 - cdfNow)}</b>
                  </div>
                  <div className="sim-share-bar">
                    <span className="sim-share-fill navy" style={{ width: `${(1 - cdfNow) * 100}%` }} />
                  </div>
                  <div className="sim-share-meta">
                    clock <b>+{Math.round(clock)}h</b> of a <b>{sim.windowHours}h</b> window
                  </div>
                </div>
              </div>
              <div className="sim-hero-chart">
                <Chart option={cdfOption} height={158} />
              </div>
            </div>
            <div className="sim-hero-foot">
              <div className="sim-hero-cell orange">
                <b>{aggregate.expectedBreaches.toFixed(2)}</b>
                <span>paths expected to finish</span>
              </div>
              <div className="sim-hero-cell navy">
                <b>{aggregate.expectedHops.toFixed(2)}</b>
                <span>lateral hops expected</span>
              </div>
              <div className="sim-hero-cell">
                <b>
                  {aggregate.postureAfter}
                  <small style={{ fontSize: 10, marginLeft: 4 }}>{aggregate.postureAfter - livePosture >= 0 ? '▲' : '▼'}</small>
                </b>
                <span>posture after · {livePosture} now</span>
              </div>
            </div>
          </section>

          {/* ---------------- kill chain replay ---------------- */}
          <section className="sim-card sim-chain-card">
            <CardHead
              icon={<Swords size={16} />}
              tone="soft"
              title={selected ? `${selected.name} · kill-chain replay` : 'Kill-chain replay'}
              sub={
                selected
                  ? `${selected.chain.length} stages · ${selected.category} · ${pct(selected.likelihood)} completes in ${sim.trials} trials`
                  : 'no path survives this scenario'
              }
              action={
                sim.classes.length > 0 ? (
                  <div className="sim-seg" role="group" aria-label="Choose an attack path">
                    {sim.classes.slice(0, 5).map((cls) => (
                      <button
                        key={cls.key}
                        className={cx(selected?.key === cls.key && 'on')}
                        onClick={() => setSelectedKey(cls.key)}
                        title={`${cls.name} · ${pct(cls.likelihood)} · ${cls.severity}`}
                      >
                        {cls.name}
                      </button>
                    ))}
                  </div>
                ) : undefined
              }
            />
            <div className="sim-transport">
              <button
                className={cx('sim-play', playing && 'on')}
                onClick={() => (playing ? setPlaying(false) : play())}
                aria-pressed={playing}
                aria-label={playing ? 'Pause the run' : 'Play the run'}
              >
                {playing ? <Pause size={15} /> : <Play size={15} />}
              </button>
              <div className="sim-clock">
                <span className="sim-clock-value">
                  +{Math.round(clock)}h / {sim.windowHours}h
                </span>
                <span className="sim-clock-label">
                  {revealedCount} of {sim.events.length} events replayed
                </span>
              </div>
              <div className="sim-scrub">
                <input
                  className="sim-range"
                  type="range"
                  min={0}
                  max={sim.windowHours}
                  step={Math.max(0.1, sim.windowHours / 240)}
                  value={Math.min(clock, sim.windowHours)}
                  onChange={(e) => scrub(Number(e.target.value))}
                  style={{ '--pct': `${(clock / sim.windowHours) * 100}%` } as CSSProperties}
                  aria-label="Scrub the simulation clock"
                />
              </div>
              <div className="sim-seg" role="group" aria-label="Playback speed">
                {SPEEDS.map((item) => (
                  <button key={item} className={cx(speed === item && 'on')} onClick={() => setSpeed(item)}>
                    {item}×
                  </button>
                ))}
              </div>
              <button className="sim-icon-btn" onClick={restart} aria-label="Restart the run from hour zero">
                <RotateCcw size={13} />
              </button>
              <span className="sim-chip soft">{overrideSummary}</span>
            </div>
            {selected ? (
              <div className="sim-chain-body">
                <div className="sim-chain-rail">
                  <span className="sim-chain-rail-fill" style={{ '--w': `${railPct}%` } as CSSProperties} />
                </div>
                <ul className="sim-chain-steps">
                  {selected.chain.map((stage, index) => {
                    const event = stageState[index]
                    const reached = Boolean(event) && clock >= (event?.at ?? Infinity)
                    const state = !reached
                      ? 'is-pending'
                      : index < passed
                        ? event?.verdict === 'blocked'
                          ? 'is-blocked'
                          : 'is-done'
                        : event?.verdict === 'blocked'
                          ? 'is-blocked'
                          : 'is-active'
                    return (
                      <li className={cx('sim-step', state)} key={stage.index}>
                        <span className="sim-step-i">{String(index + 1).padStart(2, '0')}</span>
                        <div className="sim-step-main">
                          <div className="sim-step-top">
                            <span className="sim-step-tactic">{stage.tactic}</span>
                            <span className="sim-step-tech">
                              {stage.techniqueId} {stage.techniqueName}
                            </span>
                          </div>
                          <p className="sim-step-note">{stage.note}</p>
                          <div className="sim-step-bar">
                            <span className="sim-step-fill" style={{ '--w': `${stage.probability * 100}%` } as CSSProperties} />
                          </div>
                          {stage.gates.length > 0 && (
                            <div className="sim-step-gates">
                              {stage.gates.map((gate) => (
                                <span className="sim-chip positive" key={gate}>
                                  gated ×{stage.probability.toFixed(2)} · {gate}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                        <div className="sim-step-side">
                          <span className="sim-step-prob">{pct(stage.probability)}</span>
                          <span className="sim-step-time">
                            {reached ? 'resolved' : 'due'} +{event ? Math.round(event.at) : '—'}h · to end {pct(stage.cumulative)}
                          </span>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              </div>
            ) : (
              <div className="sim-chain-body">
                <Idle title="No path in this scenario" note="Every profile was ruled out by the asset type, the surface or the overrides. Try exposing the host or un-patching the package." />
              </div>
            )}
          </section>

          {/* ---------------- mechanism and evidence ---------------- */}
          <section className="sim-card sim-mech-card">
            <CardHead
              icon={<Bug size={16} />}
              title="Mechanism and evidence"
              sub={selected ? `how ${selected.name} actually happens on ${sim.assetLabel}` : 'no path selected'}
              action={
                selected ? (
                  <span className={cx('sim-chip', selected.basis === 'CVE-backed' ? 'positive' : 'soft')}>
                    {selected.basis === 'CVE-backed' ? 'flaw evidence' : 'no flaw evidence'}
                  </span>
                ) : undefined
              }
            />
            {selected ? (
              <div className="sim-split">
                <div className="sim-decode">
                  <div className="sim-decode-code">{selected.vector}</div>
                  <div className="sim-decode-grid">
                    {readings.map((metric) => (
                      <div className="sim-decode-cell" key={metric.key}>
                        <span className="sim-decode-k">{metric.label}</span>
                        <span className="sim-decode-v">{metric.name}</span>
                        <span className="sim-decode-note">{metric.note}</span>
                        <span className="sim-decode-meter" style={{ '--w': `${metric.weight * 100}%` } as CSSProperties} />
                      </div>
                    ))}
                    <div className="sim-decode-cell">
                      <span className="sim-decode-k">Mechanism fit</span>
                      <span className="sim-decode-v">{pct(selected.plan.fit)}</span>
                      <span className="sim-decode-note">
                        how well this vector behaves the way {selected.name} needs to
                      </span>
                      <span className="sim-decode-meter" style={{ '--w': `${selected.plan.fit * 100}%` } as CSSProperties} />
                    </div>
                    <div className="sim-decode-cell">
                      <span className="sim-decode-k">Entry probability</span>
                      <span className="sim-decode-v">{pct(selected.baseProbability)}</span>
                      <span className="sim-decode-note">
                        carried by the entry stage alone; every later stage is priced from its own tactic ease. Ceiling{' '}
                        {MODEL_FACTORS.entryCeiling}
                      </span>
                      <span
                        className="sim-decode-meter"
                        style={{ '--w': `${selected.baseProbability * 100}%` } as CSSProperties}
                      />
                    </div>
                  </div>
                </div>
                <div className="sim-stack">
                  <p className="sim-impact-note" style={{ marginTop: 0 }}>
                    {selected.how}
                  </p>
                  <div className="sim-inline" style={{ flexWrap: 'wrap' }}>
                    <span className="sim-chip" style={{ color: LEVEL_COLORS[selected.severity] }}>
                      {selected.severity} by profile
                    </span>
                    {selected.plan.amplified && <span className="sim-chip alert">amplified by {selected.plan.amplified}</span>}
                    {selected.cweIds.length > 0 && (
                      <span className="sim-chip soft">
                        {selected.cweIds.length} CWE {selected.cweIds.length === 1 ? 'family' : 'families'}: {selected.cweIds.join(', ')}
                      </span>
                    )}
                  </div>
                  {selected.driver ? (
                    <div className={cx('sim-impact-cell', toneOf((selected.driver.cvss ?? 0) / 10))}>
                      <span className="sim-impact-k">Driving flaw</span>
                      <span className="sim-impact-v" style={{ fontSize: 17 }}>
                        {selected.driver.id}
                      </span>
                      <span className="sim-impact-note">
                        {selected.driver.title} · CVSS {selected.driver.cvss?.toFixed(1) ?? '—'} · EPSS{' '}
                        {selected.driver.epss != null ? pct(selected.driver.epss) : '—'}
                        {selected.driver.kev ? ' · on CISA KEV' : ''} · fixed in {selected.driver.fixVersion}
                      </span>
                      <span
                        className="sim-impact-meter"
                        style={{ '--w': `${((selected.driver.cvss ?? 0) / 10) * 100}%` } as CSSProperties}
                      />
                    </div>
                  ) : (
                    <Idle
                      title="No flaw evidence behind this path"
                      note={`Priced from the ${selected.category} profile floor alone (${pct(
                        MODEL_FACTORS.severityFloor[selected.severity],
                      )} before discounting), because no CVE in this package matches the ${selected.name} weakness family.`}
                    />
                  )}
                  <div className="sim-ctl-group">
                    <span className="sim-ctl-head">What a detector would see</span>
                    <div className="sim-inline" style={{ flexWrap: 'wrap', gap: 6 }}>
                      {selected.indicators.map((indicator) => (
                        <span className="sim-chip" key={indicator}>
                          {indicator}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="sim-ctl-group">
                    <span className="sim-ctl-head">Ruled out in this scenario</span>
                    {sim.ruledOut.length === 0 ? (
                      <div className="sim-toggle-row">
                        <span>Nothing — every profile applies to this host</span>
                      </div>
                    ) : (
                      sim.ruledOut.map((item) => (
                        <div className="sim-toggle-row" key={item.key}>
                          <span>{item.name}</span>
                          <span className="sim-cell-mono" style={{ textAlign: 'right', color: 'var(--sim-muted)' }}>
                            {item.reason}
                          </span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="sim-decode">
                <Idle title="Nothing to explain" note="This scenario leaves no attack path standing." />
              </div>
            )}
          </section>

          {/* ---------------- monte carlo ---------------- */}
          <section className="sim-card sim-mc-card">
            <CardHead
              icon={<BarChart3 size={16} />}
              title="Monte Carlo"
              sub={`${sim.trials} trials · seed ${sim.seed} · ${sim.classes.length} independent paths`}
              action={<span className="sim-chip soft">{sim.windowHours}h window</span>}
            />
            <div className="sim-rhythm-body">
              <div className="sim-rhythm-hero">
                <div className="sim-rhythm-num">
                  {pct(cdfNow)}
                  <small>by +{Math.round(clock)}h</small>
                </div>
                <p className="sim-rhythm-note">
                  {breachesByNow} of {sim.trials} trials had at least one path finish by the clock
                </p>
              </div>
              <div className="sim-rhythm-grid">
                {aggregate.histogram.map((bin, index) => {
                  const past = bin.to <= clock
                  const current = clock >= bin.from && clock < bin.to
                  const count = blocksOf(bin.count, maxBin)
                  return (
                    <div className="sim-rhythm-col" key={bin.label} title={`${bin.label} · ${bin.count} breaches`}>
                      <span className={cx('sim-rhythm-flag', current && 'on')} />
                      <div className="sim-rhythm-blocks">
                        {Array.from({ length: count }, (_, block) => (
                          <span
                            key={block}
                            className={cx('sim-rhythm-block', past ? 'orange' : current ? 'navy' : 'slate')}
                            style={{ animationDelay: `${index * 30 + block * 18}ms` }}
                          />
                        ))}
                      </div>
                      <span className="sim-rhythm-hour">{Math.round(bin.from)}</span>
                    </div>
                  )
                })}
              </div>
              <div className="sim-rhythm-legend">
                <span>
                  <i style={{ background: 'var(--sim-orange)' }} /> finished before the clock
                </span>
                <span>
                  <i style={{ background: 'var(--sim-bar-2)' }} /> the bin the clock sits in
                </span>
                <span>
                  <i style={{ background: 'var(--sim-bar-3)' }} /> still ahead
                </span>
                <span>
                  <i style={{ background: 'var(--sim-track)' }} /> 1 block ≈ {Math.max(1, Math.round(maxBin / 10))} trial
                  {maxBin > 10 ? 's' : ''}
                </span>
              </div>
              <div className="sim-ladder">
                {([
                  ['p10', aggregate.quantiles.p10],
                  ['p50', aggregate.quantiles.p50],
                  ['mean', aggregate.quantiles.mean],
                  ['p90', aggregate.quantiles.p90],
                ] as const).map(([label, value]) => (
                  <div className="sim-ladder-row" key={label}>
                    <span className="sim-ladder-label">{label}</span>
                    <div className="sim-ladder-track">
                      <i style={{ width: `${clamp((value / sim.windowHours) * 100, 0, 100)}%` }} />
                    </div>
                    <span className="sim-ladder-val">{hrs(value)}h</span>
                  </div>
                ))}
              </div>
              <div className="sim-note">
                <Info size={13} />
                <span>
                  Each path is walked stage by stage with a seeded random draw, then paired trial-by-trial across paths. Same
                  inputs, same run: change one control and only that gate moves.
                </span>
              </div>
            </div>
          </section>

          {/* ---------------- class × tactic heat ---------------- */}
          <section className="sim-card sim-heat-card">
            <CardHead
              icon={<Grid3X3 size={16} />}
              title="Where each path bleeds"
              sub="cumulative reach at the end of each tactic — click a class to load its chain"
              action={<span className="sim-chip soft">{sim.heat.rows.length} × {sim.heat.cols.length}</span>}
            />
            <div className="sim-heat-scroll">
              {sim.heat.rows.length ? (
                <>
                  <div className="sim-heat" style={{ '--cols': sim.heat.cols.length } as CSSProperties}>
                    <span className="sim-heat-corner">path</span>
                    {sim.heat.cols.map((col) => (
                      <span className="sim-heat-colhead" key={col} title={col}>
                        {acronym(col)}
                      </span>
                    ))}
                    <span className="sim-heat-corner">end</span>
                    {sim.heat.rows.map((row) => (
                      <div className="sim-heat-row" key={row.key}>
                        <button
                          className="sim-heat-label"
                          onClick={() => setSelectedKey(row.key)}
                          aria-current={selected?.key === row.key ? 'true' : undefined}
                        >
                          <b>{row.name}</b>
                          <span className="mono">
                            {row.cwe.length ? row.cwe.join(' ') : 'profile-only'}
                            {selected?.key === row.key ? ' · shown below' : ''}
                          </span>
                        </button>
                        {row.cells.map((value, cellIndex) => (
                          <span
                            className={cx('sim-heat-cell', `lvl-${heatLevel(value)}`)}
                            key={`${row.key}-${sim.heat.cols[cellIndex]}`}
                            title={`${row.name} · ${sim.heat.cols[cellIndex]} · reach ${pct(value)}`}
                          />
                        ))}
                        <span className="sim-heat-rowtotal">{Math.round(row.total * 100)}%</span>
                      </div>
                    ))}
                  </div>
                  <div className="sim-heat-scale">
                    reach lost
                    <i />
                    <i />
                    <i />
                    <i />
                    <i />
                    <i />
                    kept
                  </div>
                </>
              ) : (
                <Idle title="No surface" note="Nothing was modelled, so there is no attrition to show." />
              )}
            </div>
          </section>

          {/* ---------------- blast radius ---------------- */}
          <section className="sim-card sim-spread-card">
            <CardHead
              icon={<Network size={16} />}
              title="What else can happen"
              sub={`${asset.name} outward over 3 hops, along shared software`}
              action={<span className="sim-chip soft">{sim.spread.length} hosts</span>}
            />
            {sim.spread.length ? (
              <div className="sim-spread">
                {sim.spread.map((item) => (
                  <div className={cx('sim-spread-row', `hop-${item.hop}`)} key={item.assetId}>
                    <span className="sim-spread-hop">H{item.hop}</span>
                    <div className="sim-spread-main">
                      <b>{item.name}</b>
                      <span className="mono">
                        {item.department} · {item.software} · {item.criticality}
                        {item.internetFacing ? ' · internet' : ''}
                      </span>
                    </div>
                    <div className="sim-spread-track">
                      <span className="sim-spread-fill" style={{ '--w': `${item.probability * 100}%` } as CSSProperties} />
                    </div>
                    <span className="sim-spread-val">{pct(item.probability)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="sim-spread">
                <Idle title="No second host" note="No other asset in the inventory runs this package, so the blast radius stops here." />
              </div>
            )}
            <div className="sim-decode">
              <div className="sim-note">
                <Info size={13} />
                <span>
                  Projected from the mean completion rate of the three strongest paths, discounted to 0.55 per hop, then raised
                  1.15× where the two hosts share a component and lowered for internal-only ones. Reach, not a stored incident.
                </span>
              </div>
            </div>
          </section>

          {/* ---------------- sensitivity tornado ---------------- */}
          <section className="sim-card sim-tornado-card">
            <CardHead
              icon={<Crosshair size={16} />}
              tone="soft"
              title="Which gate matters"
              sub="one gate at a time, on paired seeds"
              action={<span className="sim-chip soft">{sim.sensitivity.length} gates</span>}
            />
            <div className="sim-decode">
              <div className="sim-stack">
                {topSensitivity.map((row) => (
                  <div className="sim-compare" key={row.id}>
                    <div className="sim-compare-head">
                      <b>{row.label}</b>
                      <span>{row.delta === 0 ? 'no joint effect' : `${(row.delta * 100).toFixed(1)} pp`}</span>
                    </div>
                    <div className="sim-compare-cols">
                      <div className="sim-compare-col">
                        <div className="sim-compare-track">
                          <span className="sim-compare-fill navy" style={{ height: `${row.rateOff * 100}%` }} />
                        </div>
                        <div className="sim-compare-val">
                          <b>{pct(row.rateOff)}</b>
                          <span>gate off</span>
                        </div>
                      </div>
                      <div className="sim-compare-col">
                        <div className="sim-compare-track">
                          <span className="sim-compare-fill orange" style={{ height: `${row.rateOn * 100}%` }} />
                        </div>
                        <div className="sim-compare-val">
                          <b>{pct(row.rateOn)}</b>
                          <span>gate on</span>
                        </div>
                      </div>
                    </div>
                    <div className="sim-share-meta">
                      {row.fromClass} · gates {row.tactics.join(', ')}
                      {row === topSensitivity[0] ? ' · biggest move on the joint rate' : ''}
                    </div>
                  </div>
                ))}
                {topSensitivity.every((row) => row.delta === 0) && (
                  <div className="sim-note">
                    <Info size={13} />
                    <span>
                      No gate changes the joint rate here: the paths that finish are not the ones these controls touch. Arm a
                      gate on the top path and re-run to see the paired effect.
                    </span>
                  </div>
                )}
              </div>
            </div>
          </section>

          {/* ---------------- impact ---------------- */}
          <section className="sim-card sim-impact-card">
            <CardHead
              icon={<ShieldAlert size={16} />}
              title="What it costs"
              sub={selected ? `${selected.name} on ${asset.name} · ${asset.department}` : 'no path selected'}
              action={<span className="sim-chip">{asset.businessFunction}</span>}
            />
            {impactCells.length ? (
              <div className="sim-impact">
                {impactCells.map((cell) => (
                  <div className={cx('sim-impact-cell', toneOf(cell.weight))} key={cell.key}>
                    <span className="sim-impact-k">{cell.label}</span>
                    <span className="sim-impact-v">{cell.value}</span>
                    <span className="sim-impact-note">{cell.note}</span>
                    <span className="sim-impact-meter" style={{ '--w': `${clamp(cell.weight, 0, 1) * 100}%` } as CSSProperties} />
                  </div>
                ))}
              </div>
            ) : (
              <div className="sim-impact">
                <Idle title="Nothing to cost" note="No path stands in this scenario." />
              </div>
            )}
            {selected && (
              <div className="sim-decode">
                <p className="sim-impact-note" style={{ marginTop: 0 }}>
                  End state modelled for this path: {selected.outcome}. Impact weights come straight from the CVSS C/I/A metrics of{' '}
                  {selected.driver ? selected.driver.id : `the ${selected.name} profile vector`}; the business function is the stored
                  record for {asset.name}.
                </p>
              </div>
            )}
          </section>

          {/* ---------------- event register ---------------- */}
          <section className="sim-card sim-register-card" ref={registerCard}>
            <div className="sim-register-head" style={{ padding: '20px 20px 0' }}>
              <div className="sim-titlewrap">
                <span className="sim-card-icon">
                  <Layers size={16} />
                </span>
                <div>
                  <h2 className="sim-card-title">Event register</h2>
                  <div className="sim-card-sub">
                    one deterministic replay · {revealedCount} of {sim.events.length} shown at +{Math.round(clock)}h
                  </div>
                </div>
              </div>
              <div className="sim-card-tools">
                <div className="sim-seg" role="group" aria-label="Filter verdicts">
                  {(['all', 'success', 'blocked', 'attempt'] as const).map((item) => (
                    <button key={item} className={cx(filter === item && 'on')} onClick={() => setFilter(item)}>
                      {item}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="sim-register-scroll" ref={registerRef}>
              <table className="sim-table">
                <thead>
                  <tr>
                    <th>Clock</th>
                    <th>Path</th>
                    <th>Tactic</th>
                    <th>Verdict</th>
                    <th>Technique</th>
                    <th className="right">Stage p</th>
                    <th className="right">z</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ event, index, last }) => (
                    <tr
                      key={event.id}
                      className={cx(
                        'clickable',
                        last && 'is-new is-latest',
                        openId === event.id && 'open',
                      )}
                      onClick={() => {
                        setOpenId(openId === event.id ? null : event.id)
                        setSelectedKey(event.classKey)
                      }}
                    >
                      <td className="sim-cell-time">+{Math.round(event.at)}h</td>
                      <td>
                        {event.className}
                        <span className="sim-cell-detail">
                          {event.detail}
                          {event.cveId ? ` · ${event.cveId}` : ''}
                          {event.indicator ? ` · look for: ${event.indicator}` : ''}
                          {event.mitigation ? ` · held by ${event.mitigation}` : ''}
                          {index === 0 ? ' · first stage of this replay' : ''}
                        </span>
                      </td>
                      <td>{event.tactic}</td>
                      <td>
                        <span className={cx('sim-verdict', event.verdict)}>{event.verdict}</span>
                      </td>
                      <td className="sim-cell-mono">
                        {event.techniqueId ?? '—'} {event.techniqueName ?? ''}
                      </td>
                      <td className="sim-cell-mono right">{pct(event.probability)}</td>
                      <td className="sim-cell-mono right">
                        {event.z > 0 ? '+' : ''}
                        {event.z.toFixed(1)}σ
                      </td>
                    </tr>
                  ))}
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={7}>
                        <span className="sim-cell-detail" style={{ display: 'block' }}>
                          Nothing has resolved yet at +{Math.round(clock)}h — press play or drag the clock forward.
                        </span>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="sim-table-foot">
              <span className="sim-inline">
                <ShieldCheck size={11} /> Simulated replay — never written to the stored alert queue
              </span>
              <span className="sim-cell-mono">
                z = (stage p − μ) ÷ σ · μ {pct(meanStageP)} across {sim.events.length} stages
              </span>
            </div>
          </section>

          {/* ---------------- stored-queue overlay ---------------- */}
          <section className="sim-card sim-whatif-card">
            <CardHead
              icon={<Zap size={16} />}
              tone="soft"
              title="Stored-queue overlay"
              sub="the same overrides applied to real alert scores"
              action={
                <span className="sim-chip soft">
                  {sim.whatif.postureAfter >= sim.whatif.postureBefore ? '▲' : '▼'}{' '}
                  {Math.abs(sim.whatif.postureAfter - sim.whatif.postureBefore)} pts
                </span>
              }
            />
            <div className="sim-decode">
              <div className="sim-stack">
                <div className="sim-compare" style={{ paddingTop: 0, borderTop: 0 }}>
                  <div className="sim-compare-head">
                    <b>Posture index · {asset.name}</b>
                    <span>index = 100 · e^(−(15·critical + 6·high) ÷ 100)</span>
                  </div>
                  <div className="sim-compare-cols">
                    <div className="sim-compare-col">
                      <div className="sim-compare-track">
                        <span className="sim-compare-fill navy" style={{ height: `${sim.whatif.postureBefore}%` }} />
                      </div>
                      <div className="sim-compare-val">
                        <b>{sim.whatif.postureBefore}</b>
                        <span>baseline</span>
                      </div>
                    </div>
                    <div className="sim-compare-col">
                      <div className="sim-compare-track">
                        <span className="sim-compare-fill orange" style={{ height: `${sim.whatif.postureAfter}%` }} />
                      </div>
                      <div className="sim-compare-val">
                        <b>{sim.whatif.postureAfter}</b>
                        <span>scenario</span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="sim-ladder">
                  {whatifRows.map((row) => (
                    <div className="sim-ladder-row" key={row.alertId}>
                      <span className="sim-ladder-label">{row.cveId.replace('CVE-', '')}</span>
                      <div className="sim-ladder-track">
                        <i
                          style={{
                            width: `${clamp((row.scenario / Math.max(1, row.baseline)) * 100, 0, 100)}%`,
                            background: row.scenario < row.baseline ? 'var(--sim-green)' : 'var(--sim-orange)',
                          }}
                        />
                      </div>
                      <span className="sim-ladder-val">
                        {row.scenario - row.baseline >= 0 ? '+' : ''}
                        {fmtScore(row.scenario - row.baseline)}
                      </span>
                    </div>
                  ))}
                  {whatifRows.length === 0 && (
                    <div className="sim-toggle-row">
                      <span>No stored alerts on this asset</span>
                    </div>
                  )}
                </div>

                <div className="sim-foot-label">
                  Σ score on {asset.name}: {fmtScore(sim.whatif.sumBefore)} → {fmtScore(sim.whatif.sumAfter)} ·{' '}
                  {sim.whatif.rows.filter((row) => row.suppressedAfter).length} suppressed by the patch override
                </div>
                <div className="sim-note">
                  <ShieldCheck size={13} />
                  <span>
                    Recomputed from stored alert records under {overrideSummary}. The queue you see elsewhere in the app is
                    untouched — no write occurs.
                  </span>
                </div>
              </div>
            </div>
          </section>

          {/* ---------------- method footer ---------------- */}
          <section className="sim-card sim-foot-card" ref={footCard}>
            <CardHead
              icon={<KeyRound size={16} />}
              title="How each number was produced"
              sub="the multipliers are printed here because they are the model"
              action={<span className="sim-chip soft">formula v1.1 · deterministic</span>}
            />
            <div className="sim-foot-body">
              <div className="sim-foot-stats">
                <span className="sim-foot-label">Run parameters</span>
                <div className="sim-foot-grid">
                  <div className="sim-foot-cell">
                    <b>{sim.trials}</b>
                    <span>trials per path</span>
                    <code>mulberry32(seed + key)</code>
                  </div>
                  <div className="sim-foot-cell">
                    <b>{sim.seed}</b>
                    <span>seed</span>
                    <code>same seed replays identically</code>
                  </div>
                  <div className="sim-foot-cell">
                    <b>
                      {sim.classes.length}/{sim.classes.length + sim.ruledOut.length}
                    </b>
                    <span>paths modelled</span>
                    <code>{sim.ruledOut.length} ruled out</code>
                  </div>
                  <div className="sim-foot-cell">
                    <b>{sim.events.length}</b>
                    <span>events in the replay</span>
                    <code>{sim.windowHours}h window</code>
                  </div>
                  <div className="sim-foot-cell">
                    <b>{pct(aggregate.breachRate)}</b>
                    <span>joint breach rate</span>
                    <code>≥ 1 of {sim.classes.length} paths finishes</code>
                  </div>
                  <div className="sim-foot-cell">
                    <b>{pct(aggregate.worstClass?.likelihood ?? 0)}</b>
                    <span>strongest single path</span>
                    <code>{aggregate.worstClass?.name ?? '—'}</code>
                  </div>
                </div>
                <span className="sim-foot-label raw">Entry base = (0.22 + 0.4·CVSS/10 + 0.3·EPSS + 0.03·KEV) × relevance × fit</span>
              </div>

              <div className="sim-method">
                <span className="sim-foot-label">Five steps, in order</span>
                <div className="sim-method-steps">
                  <div className="sim-method-step">
                    <i>1</i>
                    <div>
                      <b>Applicability</b>
                      <span>
                        A {asset.type} opens a base surface, and {sim.target.product}'s own weakness families can widen it.
                        Profiles that cannot run here are listed as ruled out with the reason, not silently dropped.
                      </span>
                    </div>
                  </div>
                  <div className="sim-method-step">
                    <i>2</i>
                    <div>
                      <b>Which flaw drives it</b>
                      <span>
                        A CVE only powers a mechanism its weakness family can produce — deserialisation says nothing about
                        injection. Families per mechanism: {Object.keys(MODEL_FACTORS.mechanismCwe).length} profiles mapped, highest
                        CVSS then EPSS wins the driver seat.
                      </span>
                    </div>
                  </div>
                  <div className="sim-method-step">
                    <i>3</i>
                    <div>
                      <b>Entry probability</b>
                      <span>
                        Relevance multipliers {MODEL_FACTORS.relevance.MATCHED} / {MODEL_FACTORS.relevance.VERSION_UNKNOWN} /{' '}
                        {MODEL_FACTORS.relevance.NOT_AFFECTED} for MATCHED / unknown / not affected; mechanism fit scales{' '}
                        {MODEL_FACTORS.fitRange[0]}–{MODEL_FACTORS.fitRange[1]}; the entry stage is capped at{' '}
                        {MODEL_FACTORS.entryCeiling}. Without flaw evidence a path starts from a per-severity floor (
                        {Object.entries(MODEL_FACTORS.severityFloor).map(([level, value]) => `${level} ${value}`).join(', ')}) and
                        this card says so.
                      </span>
                    </div>
                  </div>
                  <div className="sim-method-step">
                    <i>4</i>
                    <div>
                      <b>Chain attrition</b>
                      <span>
                        Each later stage is priced from its tactic ease — Reconnaissance {MODEL_FACTORS.stageEase.Reconnaissance},
                        Lateral Movement {MODEL_FACTORS.stageEase['Lateral Movement']}, Impact {MODEL_FACTORS.stageEase.Impact} —
                        nudged by the vector's AV/AC/PR/UI/S/C/I/A, then multiplied by every armed gate. The clock only carries
                        stage durations.
                      </span>
                    </div>
                  </div>
                  <div className="sim-method-step">
                    <i>5</i>
                    <div>
                      <b>Monte Carlo, then the overlay</b>
                      <span>
                        {sim.trials} seeded walks per path, paired trial by trial for the joint rate, histogram, CDF and quantiles;
                        sensitivity re-runs the joint with one gate flipped on the same seeds. Separately, the overlay card
                        re-scores stored alerts with the formula above. Nothing is persisted.
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <div className="sim-table-foot">
              <span className="sim-inline">
                <Sparkles size={11} /> Simulated analysis on seeded demo data — computed in the browser, never stored truth
              </span>
              <span className="sim-cell-mono">
                {sim.target.vendor} {sim.target.product} · {asset.id} · {sim.version}
              </span>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
