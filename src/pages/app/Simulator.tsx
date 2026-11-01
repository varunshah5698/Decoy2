import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { Chart, axisStyle, chartTokens } from '../../components/Chart'
import { PageHeader } from '../../components/Panel'
import { StatsPanel } from '../../components/StatsPanel'
import { SeverityBadge, SimulatedBadge } from '../../components/Badges'
import {
  AlertTriangle,
  ArrowRight,
  Check,
  FlaskConical,
  Gauge,
  Info,
  Minus,
  RefreshCw,
  Server,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  TrendingUp,
  X,
  Zap,
} from '../../components/Icons'
import { postureFor } from '../../data/seed'
import { useEstate } from '../../lib/estate'
import { useTheme } from '../../lib/store'
import { cx, fmtScore } from '../../lib/format'
import { WEIGHTS, scoreAlert } from '../../lib/scoring'
import { hexA } from '../../lib/colors'
import type { Alert, Breakdown, Criticality, RiskLevel } from '../../lib/types'

const NAVY = '#1b2437'
const CORAL = '#f2683c'
const TEAL = '#0f9d8a'
const SLATE = '#97a3b4'
const GOLD = '#d9a215'
const RED = '#e04356'
const GREEN = '#2f9e6b'

const CRIT_HUE: Record<Criticality, string> = { HIGH: RED, MEDIUM: GOLD, LOW: TEAL }
const LEVELS: RiskLevel[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']
const LEVEL_HUE: Record<RiskLevel, string> = { CRITICAL: RED, HIGH: CORAL, MEDIUM: GOLD, LOW: GREEN }

type Scope = 'asset' | 'dept' | 'all'
type CritOverride = Criticality | 'baseline'

const SCOPES: { key: Scope; label: string; hint: string }[] = [
  { key: 'asset', label: 'this asset', hint: 'only the target asset is recomputed' },
  { key: 'dept', label: 'department', hint: 'every asset in the same department' },
  { key: 'all', label: 'whole estate', hint: 'all sixteen assets move together' },
]

interface Preset {
  key: string
  label: string
  hue: string
  hint: string
  crit: CritOverride
  exposed: boolean | null
  patched: boolean
  scope: Scope
}

/* One tap has to produce a visible movement, so each preset pairs an override with the
   scope wide enough to shift the posture index rather than only one row of the table. */
const PRESETS: Preset[] = [
  { key: 'patch', label: 'patch the department', hue: GREEN, hint: 'relevance gate → NOT_AFFECTED for every alert in scope', crit: 'baseline', exposed: null, patched: true, scope: 'dept' },
  { key: 'isolate', label: 'pull off the internet', hue: TEAL, hint: 'exposure points drop to zero', crit: 'baseline', exposed: false, patched: false, scope: 'asset' },
  { key: 'demote', label: 'reclassify to LOW', hue: SLATE, hint: 'criticality weight falls from 25 to 5', crit: 'LOW', exposed: null, patched: false, scope: 'asset' },
  { key: 'promote', label: 'reclassify to HIGH', hue: GOLD, hint: 'criticality weight rises to 25', crit: 'HIGH', exposed: null, patched: false, scope: 'dept' },
  { key: 'blast', label: 'worst case', hue: RED, hint: 'everything exposed, nothing patched, whole estate', crit: 'HIGH', exposed: true, patched: false, scope: 'all' },
  { key: 'remediate', label: 'best case', hue: NAVY, hint: 'department patched, demoted and taken off the internet', crit: 'LOW', exposed: false, patched: true, scope: 'dept' },
]

interface Row {
  alert: Alert
  touched: boolean
  before: number
  after: number
  levelBefore: RiskLevel
  levelAfter: RiskLevel
  suppressedAfter: boolean
  wouldHave?: number
  bdBefore: Breakdown
  bdAfter: Breakdown
  crit: Criticality
  exposed: boolean
}

function MsCard({
  title,
  sub,
  icon,
  action,
  className,
  children,
}: {
  title: string
  sub?: string
  icon?: ReactNode
  action?: ReactNode
  className?: string
  children: ReactNode
}) {
  return (
    <section className={cx('wb-card', 'ms-card', className)}>
      <header className="wb-card-head">
        <div>
          <h3>
            {icon}
            {title}
          </h3>
          {sub && <p>{sub}</p>}
        </div>
        {action}
      </header>
      <div className="wb-card-body">{children}</div>
    </section>
  )
}

function Seg<T extends string>({
  label,
  stored,
  value,
  options,
  onChange,
  wrap,
}: {
  label: string
  stored: string
  value: T
  options: { key: T; label: string; hue?: string }[]
  onChange: (next: T) => void
  wrap?: boolean
}) {
  return (
    <div className="ms-seg-block">
      <span className="ms-field-label">
        {label}
        <em>stored · {stored}</em>
      </span>
      <div className={cx('ms-seg', wrap && 'ms-seg-wrap')} role="group" aria-label={label}>
        {options.map((o) => (
          <button
            key={o.key}
            type="button"
            className={cx('ms-seg-btn', o.key === value && 'on')}
            style={o.key === value && o.hue ? ({ '--ms-on': o.hue } as CSSProperties) : undefined}
            onClick={() => onChange(o.key)}
            aria-pressed={o.key === value}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}

function Toggle({ label, hint, on, onChange }: { label: string; hint: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="ms-toggle-row">
      <div>
        <strong>{label}</strong>
        <span>{hint}</span>
      </div>
      <button
        type="button"
        className={cx('switch', on && 'on')}
        onClick={() => onChange(!on)}
        aria-label={label}
        aria-pressed={on}
      />
    </div>
  )
}

/* ---------- formula ledger ---------- */

type TermKey =
  | 'severity_points'
  | 'exploit_points'
  | 'kev_points'
  | 'criticality_points'
  | 'exposure_points'
  | 'relevance_points'

const TERMS: { key: TermKey; label: string; max: number }[] = [
  { key: 'severity_points', label: 'severity · cvss/10 × 25', max: WEIGHTS.severity },
  { key: 'exploit_points', label: 'exploit · epss × 25', max: WEIGHTS.epss },
  { key: 'kev_points', label: 'kev · known exploited', max: WEIGHTS.kev },
  { key: 'criticality_points', label: 'criticality weight', max: WEIGHTS.criticality },
  { key: 'exposure_points', label: 'internet exposure', max: WEIGHTS.exposure },
  { key: 'relevance_points', label: 'relevance gate', max: WEIGHTS.relevance },
]

export default function Simulator() {
  const theme = useTheme((s) => s.theme)
  const setTheme = useTheme((s) => s.setTheme)
  const estate = useEstate()
  const { activeAlerts, assets } = estate

  const [assetId, setAssetId] = useState('AST-HR-01')
  const [crit, setCrit] = useState<CritOverride>('baseline')
  const [exposed, setExposed] = useState<boolean | null>(null)
  const [patched, setPatched] = useState(false)
  const [scope, setScope] = useState<Scope>('asset')
  const [preset, setPreset] = useState<string | null>(null)
  const [moversOnly, setMoversOnly] = useState(false)

  // The cool-white skin is what makes this board legible, so the page opts into it
  // for the duration of its mount, exactly like the ATT&CK matrix page.
  useEffect(() => {
    const root = document.documentElement
    const previous = useTheme.getState().theme
    root.setAttribute('data-skin', 'moonrow')
    if (previous !== 'light') setTheme('light')
    return () => {
      root.removeAttribute('data-skin')
      if (previous !== 'light') setTheme(previous)
    }
  }, [setTheme])

  const target = assets.find((a) => a.id === assetId) ?? assets[0]

  const scopeIds = useMemo(() => {
    if (!target) return new Set<string>()
    if (scope === 'all') return new Set(assets.map((a) => a.id))
    if (scope === 'dept') return new Set(assets.filter((a) => a.department === target.department).map((a) => a.id))
    return new Set([target.id])
  }, [assets, scope, target])

  const rows = useMemo<Row[]>(
    () =>
      activeAlerts.map((a) => {
        const touched = scopeIds.has(a.asset.id)
        const nextCrit = touched && crit !== 'baseline' ? crit : a.asset.criticality
        const nextExposed = touched && exposed !== null ? exposed : a.asset.internetFacing
        if (!touched)
          return {
            alert: a,
            touched: false,
            before: a.score,
            after: a.score,
            levelBefore: a.level,
            levelAfter: a.level,
            suppressedAfter: a.suppressed,
            wouldHave: a.wouldHaveScored,
            bdBefore: a.breakdown,
            bdAfter: a.breakdown,
            crit: a.asset.criticality,
            exposed: a.asset.internetFacing,
          }
        const next = scoreAlert({
          cve: a.cve,
          criticality: nextCrit,
          internetFacing: nextExposed,
          relevance: patched ? 'NOT_AFFECTED' : a.relevance,
        })
        return {
          alert: a,
          touched: true,
          before: a.score,
          after: next.score,
          levelBefore: a.level,
          levelAfter: next.level,
          suppressedAfter: next.suppressed,
          wouldHave: next.wouldHaveScored,
          bdBefore: a.breakdown,
          bdAfter: next.breakdown,
          crit: nextCrit,
          exposed: nextExposed,
        }
      }),
    [activeAlerts, scopeIds, crit, exposed, patched],
  )

  const scenarioAlerts = useMemo(
    () => rows.map((r) => ({ ...r.alert, score: r.after, level: r.levelAfter, suppressed: r.suppressedAfter })),
    [rows],
  )
  const afterPosture = postureFor(scenarioAlerts, assets)
  const posture = estate.posture
  const postureDelta = afterPosture - posture

  const inScope = useMemo(() => rows.filter((r) => r.touched), [rows])
  const movers = useMemo(() => inScope.filter((r) => Math.abs(r.after - r.before) > 0.05), [inScope])
  const scoreBefore = inScope.reduce((acc, r) => acc + r.before, 0)
  const scoreAfter = inScope.reduce((acc, r) => acc + r.after, 0)
  const levelChanges = movers.filter((r) => r.levelBefore !== r.levelAfter).length
  const suppressedCount = inScope.filter((r) => r.suppressedAfter).length

  const countsBefore = LEVELS.map((l) => activeAlerts.filter((a) => a.level === l).length)
  const countsAfter = LEVELS.map((l) => scenarioAlerts.filter((a) => !a.suppressed && a.level === l).length)

  const armed = [
    patched && { k: 'patch', t: 'relevance gate → NOT_AFFECTED' },
    exposed !== null && { k: 'exposure', t: exposed ? 'forced internet-facing' : 'forced internal' },
    crit !== 'baseline' && { k: 'crit', t: `criticality → ${crit}` },
  ].filter(Boolean) as { k: string; t: string }[]

  const applyPreset = (p: Preset) => {
    setPreset(p.key)
    setCrit(p.crit)
    setExposed(p.exposed)
    setPatched(p.patched)
    setScope(p.scope)
    setMoversOnly(false)
  }
  const clearAll = () => {
    setPreset(null)
    setCrit('baseline')
    setExposed(null)
    setPatched(false)
    setScope('asset')
    setMoversOnly(false)
  }

  /* ---------- movers chart: diverging Δ, so a no-op scenario reads as a no-op ---------- */
  const moversOption = useMemo(() => {
    const ax = axisStyle(theme)
    const top = [...movers].sort((a, b) => Math.abs(b.after - b.before) - Math.abs(a.after - a.before)).slice(0, 12)
    const labels = top.map((r) => r.alert.cve.id.replace('CVE-', ''))
    const deltas = top.map((r) => Math.round((r.after - r.before) * 10) / 10)
    /* A symmetric axis would waste half the card whenever every mover moves one way, so the
       range is fitted to the actual sign of the deltas and the zero line stays legible. */
    const low = Math.min(0, ...deltas)
    const high = Math.max(0, ...deltas)
    return {
      grid: { left: 8, right: 34, top: 12, bottom: 26, containLabel: true },
      xAxis: {
        type: 'value',
        min: low === 0 ? -10 : low * 1.22,
        max: high === 0 ? 10 : high * 1.22,
        ...ax,
        splitLine: { ...ax.splitLine, show: true },
        axisLabel: { ...ax.axisLabel, fontSize: 8.5 },
      },
      yAxis: {
        type: 'category',
        data: labels,
        inverse: true,
        ...ax,
        splitLine: { show: false },
        axisLabel: { ...ax.axisLabel, fontSize: 8.5, fontFamily: 'JetBrains Mono Variable, monospace' },
      },
      tooltip: {
        trigger: 'item',
        formatter: (p: { dataIndex: number }) => {
          const r = top[p.dataIndex]
          const d = r.after - r.before
          return `<strong>${r.alert.cve.id}</strong><br/>${fmtScore(r.before)} → ${fmtScore(r.after)}<br/>${
            d < 0 ? '−' : '+'
          }${fmtScore(Math.abs(d))} · ${r.levelBefore} → ${r.suppressedAfter ? 'SUPPRESSED' : r.levelAfter}`
        },
      },
      series: [
        {
          type: 'bar',
          barWidth: 12,
          data: deltas.map((d) => ({
            value: d,
            itemStyle: { color: d < 0 ? GREEN : d > 0 ? RED : SLATE, borderRadius: d < 0 ? [0, 4, 4, 0] : [4, 0, 0, 4] },
            /* position:'right' parks a negative bar's label on the zero line, which is where
               the reader expects the value to be empty — so each sign gets its own side. */
            label: { position: d < 0 ? 'left' : 'right' },
          })),
          label: {
            show: true,
            position: 'right',
            distance: 5,
            formatter: (p: { value: number }) => (p.value === 0 ? '—' : `${p.value > 0 ? '+' : ''}${p.value}`),
            fontSize: 8.5,
            fontFamily: 'JetBrains Mono Variable, monospace',
            color: chartTokens(theme).muted,
          },
          markLine: {
            silent: true,
            symbol: 'none',
            lineStyle: { color: hexA(NAVY, 0.32), width: 1 },
            data: [{ xAxis: 0 }],
            label: { show: false },
          },
        },
      ],
    }
  }, [movers, theme])

  /* ---------- level migration: grouped counts, the queue reshaping itself ---------- */
  const levelsOption = useMemo(() => {
    const t = chartTokens(theme)
    const ax = axisStyle(theme)
    return {
      grid: { left: 8, right: 12, top: 34, bottom: 4, containLabel: true },
      legend: {
        top: 0,
        right: 0,
        itemWidth: 9,
        itemHeight: 9,
        textStyle: { color: t.muted, fontSize: 8.5, fontFamily: 'JetBrains Mono Variable, monospace' },
      },
      xAxis: { type: 'category', data: LEVELS.map((l) => l[0] + l.slice(1).toLowerCase()), ...ax, splitLine: { show: false } },
      yAxis: { type: 'value', ...ax },
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      series: [
        /* Per-bar colours come from the level, so the series colour exists only to keep the
           legend swatch honest instead of falling back to the default palette. */
        {
          name: 'baseline',
          type: 'bar',
          barWidth: '26%',
          color: hexA(SLATE, 0.6),
          data: countsBefore.map((v, i) => ({ value: v, itemStyle: { color: hexA(LEVEL_HUE[LEVELS[i]], 0.3), borderRadius: [3, 3, 0, 0] } })),
        },
        {
          name: 'scenario',
          type: 'bar',
          barWidth: '26%',
          color: NAVY,
          data: countsAfter.map((v, i) => ({ value: v, itemStyle: { color: LEVEL_HUE[LEVELS[i]], borderRadius: [3, 3, 0, 0] } })),
        },
      ],
    }
  }, [countsBefore.join(), countsAfter.join(), theme])

  const focus = movers[0] ?? inScope[0]
  const termRows = TERMS.map((term) => ({
    ...term,
    before: focus ? focus.bdBefore[term.key] : 0,
    after: focus ? focus.bdAfter[term.key] : 0,
  }))

  const tableRows = moversOnly ? movers : [...inScope].sort((a, b) => Math.abs(b.after - b.before) - Math.abs(a.after - a.before))
  const assetCounts = useMemo(() => {
    const m = new Map<string, number>()
    for (const a of activeAlerts) m.set(a.asset.id, (m.get(a.asset.id) ?? 0) + 1)
    return m
  }, [activeAlerts])

  return (
    <div className="page ms-page">
      <PageHeader
        eyebrow="COMPONENT 10 · WHAT-IF SIMULATOR"
        title="Change one thing, watch the queue"
        description="Patch, expose or reclassify an asset in a scenario overlay. Stored alerts never move — only this computed view does."
        actions={
          <>
            <button className="btn btn-ghost btn-sm" onClick={clearAll}>
              <RefreshCw size={13} /> Reset scenario
            </button>
            <span className="chip">
              <SimulatedBadge /> scenario overlay
            </span>
          </>
        }
      />

      <div className="ms-presets">
        <span className="ms-presets-label">
          <Zap size={10} /> one tap
        </span>
        <div className="ms-preset-row">
          {PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              className={cx('ms-preset', preset === p.key && 'on')}
              style={preset === p.key ? ({ '--ms-on': p.hue } as CSSProperties) : undefined}
              onClick={() => applyPreset(p)}
              title={p.hint}
            >
              <i style={{ background: p.hue }} />
              {p.label}
            </button>
          ))}
        </div>
        <span className="ms-preset-hint">
          {preset ? PRESETS.find((p) => p.key === preset)?.hint : 'each preset pairs an override with a scope wide enough to move the index'}
        </span>
      </div>

      <div className="ms-board">
        <aside className="ms-rail">
          <MsCard
            title="Target asset"
            sub={`${assets.length} assets · ${activeAlerts.length} active alerts`}
            icon={<Server size={13} />}
          >
            <div className="ms-assets" role="listbox" aria-label="Target asset">
              {assets.map((a) => {
                const n = assetCounts.get(a.id) ?? 0
                return (
                  <button
                    key={a.id}
                    type="button"
                    role="option"
                    aria-selected={a.id === target?.id}
                    className={cx('ms-asset', a.id === target?.id && 'on')}
                    onClick={() => {
                      setAssetId(a.id)
                      setPreset(null)
                    }}
                  >
                    <i style={{ background: CRIT_HUE[a.criticality] }} />
                    <span className="ms-asset-name">{a.name}</span>
                    <span className="ms-asset-meta">
                      {a.department} · {a.internetFacing ? 'internet' : 'internal'}
                    </span>
                    <em className="mono">{n}</em>
                  </button>
                )
              })}
            </div>
          </MsCard>

          <MsCard title="Overrides" sub="Applied to every alert in scope" icon={<SlidersHorizontal size={13} />}>
            <Seg
              label="Criticality"
              stored={target?.criticality ?? '—'}
              value={crit}
              wrap
              onChange={(v) => {
                setCrit(v)
                setPreset(null)
              }}
              options={[
                { key: 'baseline', label: 'keep', hue: SLATE },
                { key: 'HIGH', label: 'HIGH · 25', hue: RED },
                { key: 'MEDIUM', label: 'MED · 15', hue: GOLD },
                { key: 'LOW', label: 'LOW · 5', hue: TEAL },
              ]}
            />
            <Seg
              label="Internet exposure"
              stored={target?.internetFacing ? 'internet-facing' : 'internal'}
              value={exposed === null ? 'keep' : exposed ? 'on' : 'off'}
              onChange={(v) => {
                setExposed(v === 'keep' ? null : v === 'on')
                setPreset(null)
              }}
              options={[
                { key: 'keep', label: 'keep', hue: SLATE },
                { key: 'on', label: 'exposed · +5', hue: CORAL },
                { key: 'off', label: 'internal · 0', hue: TEAL },
              ]}
            />
            <div className="ms-seg-block">
              <Seg
                label="Scope"
                stored={target?.department ?? '—'}
                value={scope}
                onChange={(v) => {
                  setScope(v)
                  setPreset(null)
                }}
                options={[
                  { key: 'asset', label: 'this asset' },
                  { key: 'dept', label: 'department' },
                  { key: 'all', label: 'estate' },
                ]}
              />
              <p className="ms-note">{SCOPES.find((s) => s.key === scope)?.hint}</p>
            </div>
            <Toggle
              label="Patch to fixed version"
              hint={patched ? 'gate → NOT_AFFECTED · score zeroed' : 'relevance stays as stored'}
              on={patched}
              onChange={(v) => {
                setPatched(v)
                setPreset(null)
              }}
            />
          </MsCard>

          <MsCard title="Armed overrides" sub="What this scenario actually changes" icon={<FlaskConical size={13} />}>
            {armed.length ? (
              <div className="ms-armed">
                {armed.map((a) => (
                  <div className="ms-armed-row" key={a.k}>
                    <Check size={11} />
                    <span>{a.t}</span>
                    <button
                      type="button"
                      aria-label={`Clear ${a.k}`}
                      onClick={() => {
                        if (a.k === 'patch') setPatched(false)
                        if (a.k === 'exposure') setExposed(null)
                        if (a.k === 'crit') setCrit('baseline')
                        setPreset(null)
                      }}
                    >
                      <X size={11} />
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="wb-empty ms-empty">
                <Info size={13} />
                <p>
                  Nothing is overridden, so the scenario equals the stored estate. Pick a one-tap scenario above or
                  set an override to see the queue move.
                </p>
              </div>
            )}
            <div className="ms-armed-foot">
              <ShieldCheck size={11} />
              <span>Base alerts, acknowledgements and stored scores are untouched.</span>
            </div>
          </MsCard>
        </aside>

        <div className="ms-main">
          <div className="wb-metrics ms-metrics">
            <div className="wb-metric">
              <span>posture index</span>
              <b className={cx(postureDelta > 0 && 'tone-low', postureDelta < 0 && 'tone-critical')}>{afterPosture}</b>
              <div className="ms-metric-foot">
                <span className="mono">from {posture}</span>
                <span className={cx('ms-pill', postureDelta > 0 ? 'up' : postureDelta < 0 ? 'down' : 'flat')}>
                  {postureDelta > 0 ? '▲' : postureDelta < 0 ? '▼' : '—'} {Math.abs(postureDelta)}
                </span>
              </div>
            </div>
            <div className="wb-metric">
              <span>alerts in scope</span>
              <b>{inScope.length}</b>
              <div className="ms-metric-foot">
                <span className="mono">{SCOPES.find((s) => s.key === scope)?.label}</span>
                <span className="mono">{scopeIds.size} asset{scopeIds.size === 1 ? '' : 's'}</span>
              </div>
            </div>
            <div className="wb-metric">
              <span>score sum</span>
              <b>{fmtScore(scoreAfter)}</b>
              <div className="ms-metric-foot">
                <span className="mono">was {fmtScore(scoreBefore)}</span>
                <span className={cx('ms-pill', scoreAfter < scoreBefore ? 'up' : scoreAfter > scoreBefore ? 'down' : 'flat')}>
                  {scoreAfter === scoreBefore ? '—' : `${scoreAfter > scoreBefore ? '+' : ''}${fmtScore(scoreAfter - scoreBefore)}`}
                </span>
              </div>
            </div>
            <div className="wb-metric">
              <span>levels that move</span>
              <b className={cx(levelChanges > 0 && 'tone-high')}>{levelChanges}</b>
              <div className="ms-metric-foot">
                <span className="mono">{movers.length} scores changed</span>
              </div>
            </div>
            <div className="wb-metric">
              <span>suppressed by gate</span>
              <b className={cx(suppressedCount > 0 && 'tone-low')}>{suppressedCount}</b>
              <div className="ms-metric-foot">
                <span className="mono">{patched ? 'NOT_AFFECTED applied' : 'gate untouched'}</span>
              </div>
            </div>
          </div>

          <div className="ms-duo">
            <MsCard title="Posture · before / after" sub="100 − mean of each asset's worst active score" icon={<Gauge size={13} />}>
              <div className="ms-dials">
                <div className="ms-dial">
                  <div className="ms-dial-ring" style={{ '--ms-pct': posture, '--ms-hue': SLATE } as CSSProperties}>
                    <b>{posture}</b>
                  </div>
                  <span>baseline</span>
                </div>
                <ArrowRight size={15} className="ms-dial-arrow" />
                <div className="ms-dial">
                  <div
                    className="ms-dial-ring"
                    style={{ '--ms-pct': afterPosture, '--ms-hue': postureDelta >= 0 ? GREEN : RED } as CSSProperties}
                  >
                    <b>{afterPosture}</b>
                  </div>
                  <span>scenario</span>
                </div>
              </div>
              <div className="ms-dial-foot">
                <span className="mono">
                  critical {countsAfter[0]} · high {countsAfter[1]} · medium {countsAfter[2]} · low {countsAfter[3]}
                </span>
                <span className={cx('ms-pill lg', postureDelta > 0 ? 'up' : postureDelta < 0 ? 'down' : 'flat')}>
                  {postureDelta === 0
                    ? 'no movement yet'
                    : `${postureDelta > 0 ? '+' : ''}${postureDelta} posture points`}
                </span>
              </div>
            </MsCard>

            <MsCard title="Queue by level" sub="How the active set redistributes" icon={<TrendingUp size={13} />}>
              <Chart option={levelsOption} height={214} />
            </MsCard>
          </div>

          <MsCard
            title="Score movers"
            sub={
      movers.length
        ? `Δ per alert, largest shift first · green reduces risk · top ${Math.min(12, movers.length)} of ${movers.length}`
        : 'No alert has moved — set an override above'
    }
            icon={<AlertTriangle size={13} />}
            className="ms-tall"
          >
            {movers.length ? (
              <Chart option={moversOption} height={Math.max(180, Math.min(12, movers.length) * 26 + 52)} />
            ) : (
              <div className="wb-empty ms-empty tall">
                <Minus size={15} />
                <p>
                  Every alert in scope keeps its stored score, so there is nothing to plot. Choose a
                  one-tap scenario or arm an override to see the deltas.
                </p>
                <button type="button" className="ms-preset" onClick={() => applyPreset(PRESETS[0])}>
                  <i style={{ background: PRESETS[0].hue }} />
                  or try {PRESETS[0].label}
                </button>
              </div>
            )}
          </MsCard>

          <MsCard
            title="Why the number moved"
            sub={focus ? `${focus.alert.cve.id} on ${focus.alert.asset.name} · formula term by term` : 'no alert in scope'}
            icon={<SlidersHorizontal size={13} />}
          >
            {focus ? (
              <>
                <div className="ms-terms-head">
                  <span>term</span>
                  <span>baseline</span>
                  <span>scenario</span>
                </div>
                <div className="wb-bars ms-terms">
                  {termRows.map((r) => (
                    <div className="ms-term" key={String(r.key)}>
                      <span className="wb-bar-label">{r.label}</span>
                      <div className="ms-term-track">
                        <i className="before" style={{ width: `${(r.before / r.max) * 100}%` }} />
                        <i
                          className="after"
                          style={{
                            width: `${(r.after / r.max) * 100}%`,
                            background: r.after === r.before ? SLATE : r.after < r.before ? GREEN : RED,
                          }}
                        />
                      </div>
                      <em className={cx('mono', r.after < r.before ? 'good' : r.after > r.before ? 'bad' : '')}>
                        {fmtScore(r.before)} → {fmtScore(r.after)}
                      </em>
                    </div>
                  ))}
                </div>
                <div className="ms-term-foot">
                  <span className="mono">
                    raw {fmtScore(focus.bdBefore.total_raw)} → {fmtScore(focus.bdAfter.total_raw)}
                  </span>
                  <span className="mono">
                    capped {fmtScore(focus.before)} → {fmtScore(focus.after)}
                  </span>
                  {focus.suppressedAfter && focus.wouldHave != null && (
                    <span className="mono violet">would have scored {fmtScore(focus.wouldHave)}</span>
                  )}
                </div>
              </>
            ) : (
              <div className="wb-empty ms-empty">
                <Info size={13} />
                <p>This asset carries no active alert, so there is no score to decompose.</p>
              </div>
            )}
          </MsCard>

          <MsCard
            title={`Recomputed alerts · ${target?.name ?? '—'}`}
            sub="Stored value, scenario value, and what the gate did"
            icon={<Server size={13} />}
            action={
              <button type="button" className={cx('ms-filter', moversOnly && 'on')} onClick={() => setMoversOnly((v) => !v)}>
                {moversOnly ? 'showing movers' : 'show movers only'}
                <em className="mono">{movers.length}</em>
              </button>
            }
          >
            {inScope.length ? (
              <div className="ms-table-scroll">
                <table className="data-table ms-table">
                  <thead>
                    <tr>
                      <th>CVE</th>
                      <th>asset</th>
                      <th>baseline</th>
                      <th>scenario</th>
                      <th>Δ</th>
                      <th>level after</th>
                      <th>note</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tableRows.map((r) => {
                      const d = Math.round((r.after - r.before) * 10) / 10
                      return (
                        <tr key={r.alert.id} className={cx(d !== 0 && 'moved')}>
                          <td className="mono">{r.alert.cve.id}</td>
                          <td>{r.alert.asset.name}</td>
                          <td className="mono">{fmtScore(r.before)}</td>
                          <td className="mono strong">{fmtScore(r.after)}</td>
                          <td>
                            <span className={cx('ms-pill', d < 0 ? 'up' : d > 0 ? 'down' : 'flat')}>
                              {d === 0 ? '—' : `${d > 0 ? '+' : ''}${fmtScore(d)}`}
                            </span>
                          </td>
                          <td>
                            <SeverityBadge level={r.levelAfter} suppressed={r.suppressedAfter} />
                          </td>
                          <td className="cell-sub">
                            {r.suppressedAfter && r.wouldHave != null
                              ? `gate → NOT_AFFECTED · would have scored ${fmtScore(r.wouldHave)}`
                              : `${r.crit} criticality · ${r.exposed ? 'internet' : 'internal'}`}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="wb-empty ms-empty">
                <Info size={13} />
                <p>No active alert is attached to this asset. Pick another target to see recomputation.</p>
              </div>
            )}
            <div className="table-note ms-note-row">
              <span className="inline-flex">
                <Info size={11} /> {inScope.length} of {activeAlerts.length} active alerts are in scope across{' '}
                {scopeIds.size} asset{scopeIds.size === 1 ? '' : 's'}. No write occurs — the seeded estate is unchanged.
              </span>
              <span className="mono">scenario clock {estate.nowIso.slice(11, 16)}Z · formula v1.1</span>
            </div>
          </MsCard>

          <StatsPanel
            stats={[
              { name: 'Posture delta', value: `${postureDelta >= 0 ? '+' : ''}${postureDelta}`, formula: 'scenario index − baseline index', n: activeAlerts.length },
              { name: 'Score delta · scope', value: `${scoreAfter - scoreBefore >= 0 ? '+' : ''}${fmtScore(scoreAfter - scoreBefore)}`, formula: 'Σ scenario − Σ baseline in scope', n: inScope.length },
              { name: 'Alerts that moved', value: `${movers.length} of ${inScope.length}`, formula: 'rows where |Δ| > 0.05', n: inScope.length },
              { name: 'Suppressed by gate', value: String(suppressedCount), formula: 'relevance = NOT_AFFECTED or PRODUCT_ABSENT', n: inScope.length },
              { name: 'Assets in scope', value: `${scopeIds.size} of ${assets.length}`, formula: SCOPES.find((s) => s.key === scope)?.hint ?? '', n: assets.length },
            ]}
          />
        </div>
      </div>

      <div className="page-foot">
        <span className="inline-flex">
          <Sparkles size={11} /> Scenario values are computed, never persisted. All inputs trace to the{' '}
          {estate.coverage.hasUploads ? 'uploaded estate plus seeded' : 'seeded'} inventory.
        </span>
        <span className="mono">formula v1.1 · deterministic</span>
      </div>
    </div>
  )
}
