import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { Chart } from '../../components/Chart'
import { PageHeader } from '../../components/Panel'
import { StatsPanel } from '../../components/StatsPanel'
import { TechniqueWorkbench, type TechniqueContext } from '../../components/TechniqueWorkbench'
import { SourceBadge } from '../../components/Badges'
import { Counter } from '../../components/Counter'
import {
  ArrowRight,
  BarChart3,
  Boxes,
  Crosshair,
  ExternalLink,
  Gauge,
  Grid3X3,
  Info,
  Layers,
  Radar as RadarIcon,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  TrendingUp,
  X,
} from '../../components/Icons'
import { DEMO_NOW, attackProfiles, mitreTactics, techniques } from '../../data/seed'
import { useTheme } from '../../lib/store'
import { hexA, levelColor } from '../../lib/colors'
import { cx } from '../../lib/format'
import { groupBy, median, sum } from '../../lib/stats'
import type { AttackProfile, RiskLevel, Technique } from '../../lib/types'

const NAVY = '#1b2437'
const CORAL = '#f2683c'
const TEAL = '#0f9d8a'
const SLATE = '#97a3b4'
const GOLD = '#d9a215'
const RED = '#e04356'
const MUTED = '#8b97a9'
const AXIS = 'rgba(27, 36, 55, 0.1)'
const MONO = 'JetBrains Mono Variable, monospace'

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']

const TACTIC_HUES = [CORAL, '#ff8a5c', NAVY, '#43547a', TEAL, '#5cc4b3', GOLD, '#eabf57', SLATE, RED]

const SEV_RANK: Record<RiskLevel, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 }

/* radar spokes sit against the card edge, so long tactic names get a fixed short form */
const RADAR_ABBR: Record<string, string> = {
  'Initial Access': 'Initial Acc.',
  'Privilege Escalation': 'Priv. Esc.',
  'Defense Evasion': 'Def. Evasion',
  'Credential Access': 'Cred. Access',
  'Lateral Movement': 'Lateral Mvmt',
  'Command & Control': 'C2',
}
const SEV_WEIGHT: Record<RiskLevel, number> = { CRITICAL: 3, HIGH: 2, MEDIUM: 1.5, LOW: 1 }

type Lens = 'volume' | 'playbooks' | 'exposure'

interface Node {
  tech: Technique
  profiles: AttackProfile[]
  severity: RiskLevel | null
  exposure: number
}

interface Column {
  id: string
  name: string
  nodes: Node[]
  events: number
  owned: number
}

const LENSES: { key: Lens; label: string; hue: string; unit: string; note: string; value: (n: Node) => number }[] = [
  { key: 'volume', label: 'Observed', hue: CORAL, unit: 'events', note: 'observed events carried by each technique', value: (n) => n.tech.observed },
  { key: 'playbooks', label: 'Playbooks', hue: TEAL, unit: 'profiles', note: 'attack profiles that map this technique', value: (n) => n.profiles.length },
  { key: 'exposure', label: 'Exposure', hue: NAVY, unit: 'pts', note: 'observed events × severity weight of the linked profiles', value: (n) => n.exposure },
]

const unitFor = (v: number, u: string) => (v === 1 ? u.replace(/s$/, '') : u)

function buildModel(techs: Technique[]) {
  const model: Node[] = techs.map((tech) => {
    const profiles = attackProfiles.filter((p) => p.techniques.includes(tech.id))
    const severity = profiles.length
      ? [...profiles].sort((a, b) => SEV_RANK[a.defaultSeverity] - SEV_RANK[b.defaultSeverity])[0].defaultSeverity
      : null
    return { tech, profiles, severity, exposure: Math.round(tech.observed * (severity ? SEV_WEIGHT[severity] : 1) * 10) / 10 }
  })

  const byTactic = groupBy(model, (n) => n.tech.tacticId)

  const columns: Column[] = mitreTactics.map((t) => {
    const nodes = byTactic[t.id] ?? []
    return {
      id: t.id,
      name: t.name,
      nodes,
      events: sum(nodes.map((n) => n.tech.observed)),
      owned: nodes.filter((n) => n.profiles.length).length,
    }
  })

  const observedTotal = sum(model.map((n) => n.tech.observed))
  const ownedNodes = model.filter((n) => n.profiles.length)
  const ownedEvents = sum(ownedNodes.map((n) => n.tech.observed))
  const coveragePct = model.length ? (ownedNodes.length / model.length) * 100 : 0
  const ranked = [...model].sort((a, b) => b.tech.observed - a.tech.observed)
  const topNode = ranked[0]
  const nodeRank = new Map(model.map((n) => [n.tech.id, ranked.indexOf(n) + 1]))

  const tiers: { key: string; label: string; color: string; events: number; nodes: number }[] = [
    { key: 'critical', label: 'Critical playbooks', color: CORAL },
    { key: 'high', label: 'High playbooks', color: NAVY },
    { key: 'mid', label: 'Medium / low playbooks', color: TEAL },
    { key: 'none', label: 'No playbook yet', color: SLATE },
  ].map((tier) => {
    const bucket = model.filter((n) =>
      tier.key === 'none'
        ? n.profiles.length === 0
        : n.severity && (tier.key === 'critical' ? n.severity === 'CRITICAL' : tier.key === 'high' ? n.severity === 'HIGH' : n.severity === 'MEDIUM' || n.severity === 'LOW'),
    )
    return { ...tier, events: sum(bucket.map((n) => n.tech.observed)), nodes: bucket.length }
  })

  return { model, columns, observedTotal, ownedNodes, ownedEvents, coveragePct, ranked, topNode, nodeRank, tiers }
}

const pct = (value: number, total: number) => (total > 0 ? (value / total) * 100 : 0)
const count = (value: number, word: string) => `${value} ${word}${value === 1 ? '' : 's'}`
const initials = (name: string) =>
  (name.split(/[\s-]+/).length > 1 ? name.split(/[\s-]+/).map((w) => w[0]).join('') : name.slice(0, 2)).toUpperCase().slice(0, 3)

function MrCard({
  icon,
  title,
  sub,
  actions,
  className,
  bodyClass,
  children,
}: {
  icon: ReactNode
  title: ReactNode
  sub?: ReactNode
  actions?: ReactNode
  className?: string
  bodyClass?: string
  children: ReactNode
}) {
  return (
    <section className={cx('mr-card', className)}>
      <header className="mr-card-head">
        <span className="mr-chip" aria-hidden="true">
          {icon}
        </span>
        <div className="mr-card-titles">
          <h2>{title}</h2>
          {sub && <p>{sub}</p>}
        </div>
        {actions && <div className="mr-card-actions">{actions}</div>}
      </header>
      <div className={cx('mr-card-body', bodyClass)}>{children}</div>
    </section>
  )
}

/* Segmented half-arc: each band is its own path so framer can draw them in sequence. */
function ArcGauge({ bands, center }: { bands: { key: string; label: string; color: string; value: number }[]; center: ReactNode }) {
  const reduce = useReducedMotion()
  const total = Math.max(1, sum(bands.map((b) => b.value)))
  const R = 74
  const CX = 96
  const CY = 96
  const GAP = 2.6

  const point = (deg: number) => {
    const rad = (deg * Math.PI) / 180
    return [CX + R * Math.cos(rad), CY + R * Math.sin(rad)] as const
  }
  const arc = (from: number, to: number) => {
    const [x0, y0] = point(from)
    const [x1, y1] = point(to)
    return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${R} ${R} 0 ${to - from > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`
  }

  let cursor = 0
  const drawn = bands.map((b) => {
    const span = (b.value / total) * 180
    const seg = { ...b, from: 180 + cursor + GAP / 2, to: 180 + cursor + span - GAP / 2 }
    cursor += span
    return seg
  })

  return (
    <div className="mk-arc">
      <svg viewBox="0 0 192 108" role="img" aria-label="Observed events by playbook tier">
        <path d={arc(180, 360)} className="mk-arc-track" />
        {drawn.map((b, i) =>
          b.to <= b.from ? null : (
            <motion.path
              key={b.key}
              className="mk-arc-seg"
              d={arc(b.from, b.to)}
              stroke={b.color}
              initial={reduce ? false : { pathLength: 0, opacity: 0 }}
              animate={{ pathLength: 1, opacity: 1 }}
              transition={{ duration: 0.9, delay: 0.1 + i * 0.12, ease: [0.22, 1, 0.36, 1] }}
            />
          ),
        )}
        {[0, 25, 50, 75, 100].map((tick) => {
          const deg = 180 + tick * 1.8
          const [x0, y0] = point(deg)
          const inner = R - 13
          const rad = (deg * Math.PI) / 180
          return (
            <line
              key={tick}
              x1={CX + inner * Math.cos(rad)}
              y1={CY + inner * Math.sin(rad)}
              x2={x0}
              y2={y0}
              className="mk-arc-tick"
            />
          )
        })}
      </svg>
      <div className="mk-arc-center">{center}</div>
    </div>
  )
}

export default function Mitre() {
  const setTheme = useTheme((s) => s.setTheme)
  const reduceMotion = useReducedMotion()

  const { model, columns, observedTotal, ownedNodes, ownedEvents, coveragePct, ranked, topNode, nodeRank, tiers } =
    useMemo(() => buildModel(techniques), [])
  const year = DEMO_NOW.getUTCFullYear()

  // MoonRow surface: the cool-white skin is what makes the coral/navy matrix legible,
  // so the page opts into it for the duration of its mount, like the other analytics pages.
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

  const [lens, setLens] = useState<Lens>('volume')
  const [query, setQuery] = useState('')
  const [profileKey, setProfileKey] = useState<string | null>(null)
  const [selected, setSelected] = useState<Node | null>(null)
  const [hoverCol, setHoverCol] = useState<number | null>(null)

  const workbenchCtx = useMemo<TechniqueContext>(
    () => ({
      nodes: model,
      columns,
      order: columns.flatMap((c) => c.nodes),
      lenses: LENSES,
      months: MONTHS,
      sevWeight: SEV_WEIGHT,
      hues: { loud: CORAL, own: TEAL, risk: NAVY, quiet: SLATE },
    }),
    [model, columns],
  )

  const lensDef = LENSES.find((l) => l.key === lens)!
  const lensValue = lensDef.value
  const lensMax = Math.max(...model.map(lensValue), 1)

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return new Set(model.map((n) => n.tech.id))
    return new Set(
      model
        .filter((n) => `${n.tech.id} ${n.tech.name} ${n.tech.tactic} ${n.tech.description}`.toLowerCase().includes(q))
        .map((n) => n.tech.id),
    )
  }, [query, model])

  const filtered = model.filter((n) => matches.has(n.tech.id))
  const filtersOn = query.trim().length > 0 || profileKey !== null
  const activeProfile = attackProfiles.find((p) => p.key === profileKey) ?? null

  const inProfile = (n: Node) => !profileKey || n.profiles.some((p) => p.key === profileKey)
  const heat = (n: Node) => Math.min(1, lensValue(n) / lensMax)

  /* Monthly shape is an illustrative spread of the observed mappings — it sums to the
     same total as the matrix, but no month boundary is claimed as telemetry. */
  const monthly = useMemo(() => {
    const raw = MONTHS.map((_, i) =>
      model.reduce((a, n) => a + n.tech.observed * (0.5 + Math.abs(Math.sin((i * 1.9 + n.tech.observed * 2 + n.tech.name.length) / 2.4))), 0),
    )
    const base = sum(raw)
    return raw.map((v) => Math.round((v / base) * observedTotal * 10) / 10)
  }, [model, observedTotal])
  const peakIndex = monthly.indexOf(Math.max(...monthly))
  const monthDelta = monthly[0] > 0 ? ((monthly[monthly.length - 1] - monthly[0]) / monthly[0]) * 100 : 0
  const topTactics = [...columns].sort((a, b) => b.events - a.events).slice(0, 3)
  const topTechniques = ranked.slice(0, 3)

  const trendOption = useMemo(
    () => ({
      grid: { left: 8, right: 14, top: 18, bottom: 22, containLabel: true },
      xAxis: {
        type: 'category',
        boundaryGap: false,
        data: MONTHS,
        axisLine: { lineStyle: { color: AXIS } },
        axisTick: { show: false },
        axisLabel: { color: MUTED, fontSize: 8.5, fontFamily: MONO },
      },
      yAxis: {
        type: 'value',
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { color: MUTED, fontSize: 8.5, fontFamily: MONO },
        splitLine: { lineStyle: { color: AXIS, type: 'dashed' } },
      },
      tooltip: { trigger: 'axis', formatter: (p: any) => `${p[0].name} ${year}<br/>${p[0].value} observed mappings` },
      series: [
        {
          type: 'line',
          data: monthly,
          smooth: 0.35,
          symbol: 'circle',
          symbolSize: 6,
          showSymbol: false,
          lineStyle: { color: CORAL, width: 2 },
          itemStyle: { color: CORAL, borderColor: '#fff', borderWidth: 2 },
          areaStyle: {
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: hexA(CORAL, 0.26) },
                { offset: 1, color: hexA(CORAL, 0.01) },
              ],
            },
          },
          markPoint: {
            symbol: 'circle',
            symbolSize: 10,
            data: [{ coord: [peakIndex, monthly[peakIndex]] }],
            itemStyle: { color: NAVY, borderColor: '#fff', borderWidth: 2 },
            label: { show: false },
          },
          markLine: {
            symbol: 'none',
            silent: true,
            label: { show: false },
            lineStyle: { color: hexA(NAVY, 0.3), type: 'dashed', width: 1 },
            data: [{ xAxis: peakIndex }],
          },
        },
      ],
    }),
    [monthly, peakIndex, year],
  )

  const shareOption = useMemo(
    () => ({
      tooltip: { trigger: 'item', formatter: '{b}: {c} events ({d}%)' },
      series: [
        {
          type: 'pie',
          radius: ['62%', '86%'],
          center: ['50%', '76%'],
          startAngle: 180,
          endAngle: 0,
          minAngle: 4,
          padAngle: 2,
          label: { show: false },
          labelLine: { show: false },
          itemStyle: { borderColor: '#fff', borderWidth: 2, borderRadius: 4 },
          data: columns
            .filter((c) => c.events > 0)
            .map((c, i) => ({ name: c.name, value: c.events, itemStyle: { color: TACTIC_HUES[i % TACTIC_HUES.length] } })),
        },
      ],
    }),
    [columns],
  )

  const radarOption = useMemo(() => {
    const maxEvents = Math.max(...columns.map((c) => c.events), 1)
    return {
      radar: {
        indicator: columns.map((c) => ({ name: RADAR_ABBR[c.name] ?? c.name, max: 100 })),
        center: ['50%', '48%'],
        radius: '48%',
        splitNumber: 4,
        axisName: { color: MUTED, fontSize: 7.5, fontFamily: MONO },
        axisNameGap: 5,
        splitLine: { lineStyle: { color: AXIS } },
        splitArea: { areaStyle: { color: ['transparent', 'rgba(27,36,55,.025)'] } },
        axisLine: { lineStyle: { color: AXIS } },
      },
      legend: {
        bottom: 0,
        itemWidth: 8,
        itemHeight: 8,
        textStyle: { color: MUTED, fontSize: 9, fontFamily: MONO },
        data: ['Observed volume', 'Playbook coverage'],
      },
      tooltip: {},
      series: [
        {
          type: 'radar',
          symbolSize: 4,
          data: [
            {
              value: columns.map((c) => Math.round((c.events / maxEvents) * 100)),
              name: 'Observed volume',
              lineStyle: { color: CORAL, width: 1.8 },
              itemStyle: { color: CORAL },
              areaStyle: { color: hexA(CORAL, 0.14) },
            },
            {
              value: columns.map((c) => (c.nodes.length ? Math.round((c.owned / c.nodes.length) * 100) : 0)),
              name: 'Playbook coverage',
              lineStyle: { color: NAVY, width: 1.6, type: 'dashed' },
              itemStyle: { color: NAVY },
              areaStyle: { color: hexA(NAVY, 0.07) },
            },
          ],
        },
      ],
    }
  }, [columns])

  const medianObserved = median(model.map((n) => n.tech.observed))
  const quadrantOption = useMemo(
    () => ({
      grid: { left: 6, right: 20, top: 26, bottom: 22, containLabel: true },
      xAxis: {
        type: 'value',
        name: 'observed events',
        nameLocation: 'middle',
        nameGap: 20,
        nameTextStyle: { color: MUTED, fontSize: 8.5, fontFamily: MONO },
        min: 0,
        max: topNode.tech.observed + 1,
        axisLine: { lineStyle: { color: AXIS } },
        axisTick: { show: false },
        axisLabel: { color: MUTED, fontSize: 8.5, fontFamily: MONO },
        splitLine: { lineStyle: { color: AXIS, type: 'dashed' } },
      },
      yAxis: {
        type: 'value',
        name: 'playbooks',
        nameTextStyle: { color: MUTED, fontSize: 8.5, fontFamily: MONO },
        min: -0.5,
        max: 3,
        interval: 1,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { color: MUTED, fontSize: 8.5, fontFamily: MONO },
        splitLine: { lineStyle: { color: AXIS, type: 'dashed' } },
      },
      tooltip: {
        formatter: (p: any) =>
          `${p.data[3]}<br/>${p.data[0]} observed · ${p.data[1]} playbook${p.data[1] === 1 ? '' : 's'}<br/>exposure ${p.data[2]} pts`,
      },
      series: [
        {
          type: 'scatter',
          symbolSize: (v: number[]) => 9 + v[2] * 2.1,
          data: model.map((n) => [
            n.tech.observed,
            n.profiles.length,
            n.exposure,
            `${n.tech.id} ${n.tech.name}`,
            n.severity ? levelColor(n.severity) : SLATE,
          ]),
          itemStyle: {
            color: (p: any) => hexA(p.data[4], 0.72),
            borderColor: '#fff',
            borderWidth: 1.5,
            shadowBlur: 10,
            shadowColor: 'rgba(16,24,40,0.12)',
          },
          emphasis: { scale: 1.18, itemStyle: { shadowBlur: 18, shadowColor: hexA(CORAL, 0.4) } },
          markArea: {
            silent: true,
            itemStyle: { color: hexA(CORAL, 0.06) },
            label: { show: false },
            data: [[{ xAxis: medianObserved, yAxis: -0.5 }, { xAxis: topNode.tech.observed + 1, yAxis: 0.75 }]],
          },
          markLine: {
            silent: true,
            symbol: 'none',
            label: { show: false },
            lineStyle: { color: hexA(NAVY, 0.22), type: 'dashed' },
            data: [{ xAxis: medianObserved }, { yAxis: 1 }],
          },
        },
      ],
    }),
    [medianObserved, topNode.tech.observed],
  )

  const registerRows = useMemo(
    () => filtered.filter((n) => inProfile(n)).sort((a, b) => lensValue(b) - lensValue(a)),
    [filtered, profileKey, lens],
  )

  const jumpToMatrix = () => document.getElementById('mk-matrix')?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' })

  return (
    <div className="page">
      <PageHeader
        eyebrow="COMPONENT 11 · ATT&CK MATRIX"
        title="Behaviour, mapped to a common language"
        description="Observed technique counts sit inside a trimmed ATT&CK Enterprise subset, wired to the attack profiles that document them. The subset ships offline and is labelled as simulated reference content."
        actions={
          <a className="btn btn-ghost btn-sm" href="https://attack.mitre.org/matrices/enterprise/" target="_blank" rel="noreferrer">
            ATT&CK matrix <ExternalLink size={12} />
          </a>
        }
      />

      <div className="mr-grid">
        <aside className="mr-rail">
          <MrCard icon={<SlidersHorizontal size={15} />} title="Matrix lens" sub="Colour the grid by what you are hunting">
            <div className="mk-lens" role="group" aria-label="Matrix lens">
              {LENSES.map((l) => (
                <button
                  key={l.key}
                  type="button"
                  className={cx('mk-lens-btn', lens === l.key && 'on')}
                  aria-pressed={lens === l.key}
                  style={{ '--mk-hue': l.hue } as CSSProperties}
                  onClick={() => setLens(l.key)}
                >
                  <strong>{l.label}</strong>
                  <span>{l.unit}</span>
                </button>
              ))}
            </div>
            <p className="mk-lens-note mono">{lensDef.note}</p>

            <div className="topbar-search mk-search">
              <Search size={12} />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search technique, tactic, text…"
                aria-label="Search techniques"
              />
              {query && (
                <button type="button" className="mk-clear" onClick={() => setQuery('')} aria-label="Clear search">
                  <X size={11} />
                </button>
              )}
            </div>

            <div className="mk-chips">
              <span className="mk-chips-label mono">OVERLAY A PLAYBOOK</span>
              {attackProfiles.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  className={cx('mk-chip-btn', profileKey === p.key && 'on')}
                  aria-pressed={profileKey === p.key}
                  onClick={() => setProfileKey((k) => (k === p.key ? null : p.key))}
                >
                  <i style={{ background: levelColor(p.defaultSeverity) }} />
                  {p.name}
                </button>
              ))}
            </div>

            <div className="mk-rail-foot">
              <span className="mono">
                {filtered.length}/{model.length} techniques
              </span>
              {filtersOn && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    setQuery('')
                    setProfileKey(null)
                  }}
                >
                  Reset <X size={11} />
                </button>
              )}
            </div>
          </MrCard>

          <MrCard icon={<Gauge size={15} />} title="Playbook coverage" sub="Observed events by linked severity tier">
            <ArcGauge
              bands={tiers.map((t) => ({ key: t.key, label: t.label, color: t.color, value: t.events }))}
              center={
                <>
                  <strong>
                    <Counter to={Math.round(coveragePct)} suffix="%" />
                  </strong>
                  <span>techniques owned</span>
                  <em className="mono">
                    {ownedNodes.length}/{model.length}
                  </em>
                </>
              }
            />
            <ul className="mk-tiers">
              {tiers.map((t) => (
                <li key={t.key}>
                  <i style={{ background: t.color }} />
                  <span>{t.label}</span>
                  <strong className="mono">{t.events}</strong>
                  <em className="mono">{pct(t.events, observedTotal).toFixed(0)}%</em>
                </li>
              ))}
            </ul>
            <div className="mk-rail-stat">
              <div>
                <span className="mk-rail-num mono">{observedTotal}</span>
                <span className="mk-rail-cap">observed mappings</span>
              </div>
              <div>
                <span className="mk-rail-num mono">{ownedEvents}</span>
                <span className="mk-rail-cap">inside a playbook</span>
              </div>
            </div>
          </MrCard>

          <MrCard icon={<Layers size={15} />} title="Tactic ledger" sub="Events and ownership per column">
            <ul className="mk-ledger">
              {[...columns].sort((a, b) => b.events - a.events).map((c, i) => (
                <li key={c.id}>
                  <button type="button" onClick={jumpToMatrix}>
                    <span className="mk-ledger-name">
                      <i className="mk-dot" style={{ background: TACTIC_HUES[i % TACTIC_HUES.length] }} />
                      {c.name}
                    </span>
                    <span className="mk-ledger-meta mono">
                      {c.owned}/{c.nodes.length} owned
                    </span>
                    <span className="mk-ledger-bar">
                      <span
                        style={
                          {
                            width: `${Math.max(3, pct(c.events, Math.max(...columns.map((x) => x.events))))}%`,
                            '--mr-fill': TACTIC_HUES[i % TACTIC_HUES.length],
                          } as CSSProperties
                        }
                      />
                    </span>
                    <span className="mk-ledger-num mono">
                      {c.events}
                      <em>{pct(c.events, observedTotal).toFixed(0)}%</em>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </MrCard>
        </aside>

        <div className="mr-main">
          <MrCard
            className="mr-breakdown"
            icon={<BarChart3 size={15} />}
            title="Observed behaviour breakdown"
            sub="Illustrative 12-month spread of the observed mappings · shape driven by technique weights"
            actions={
              <button type="button" className="btn btn-ghost btn-sm" onClick={jumpToMatrix}>
                Inspect matrix <ArrowRight size={12} />
              </button>
            }
          >
            <div className="mr-bd-body">
              <div className="mr-bd-left">
                <div className="mr-bignum">
                  <Counter to={observedTotal} />
                  <span className="mr-bignum-tick" aria-hidden="true">
                    <TrendingUp size={14} />
                  </span>
                </div>
                <div className="mr-bignum-label">
                  Total observed mappings · <span className="badge low">{model.length} techniques</span>
                </div>

                <div className="mr-bars">
                  {topTactics.map((c, i) => (
                    <div className="mr-bar-row" key={c.id}>
                      <div className="mr-bar-name">
                        <i className="mr-bar-tick" style={{ background: i === 0 ? CORAL : NAVY }} />
                        {c.name}
                      </div>
                      <div className="mr-bar-track">
                        <span
                          className="mr-bar-fill"
                          style={
                            {
                              width: `${Math.max(4, pct(c.events, topTactics[0].events))}%`,
                              '--mr-fill': i === 0 ? CORAL : NAVY,
                            } as CSSProperties
                          }
                        />
                      </div>
                      <div className="mr-bar-meta">
                        <strong>{pct(c.events, observedTotal).toFixed(1)}%</strong>
                        <span className="mono"> · {count(c.events, 'event')}</span>
                      </div>
                      <div className="mr-bar-sub mono">
                        {c.id} · {c.nodes.length} rows · {c.owned} owned
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="mr-bd-right">
                <div className="mr-chart">
                  <Chart option={trendOption} height={252} />
                  <div
                    className="mr-focus"
                    aria-hidden="true"
                    style={{ left: `max(12px, calc(${(peakIndex / (MONTHS.length - 1)) * 100}% - 208px))` }}
                  >
                    <span className="mr-focus-date">
                      {MONTHS[peakIndex]} {year} · peak
                    </span>
                    <div className="mr-focus-value">
                      {Math.round(monthly[peakIndex])}
                      <small>mappings</small>
                      <em className={cx('mr-focus-delta', monthDelta >= 0 ? 'up' : 'down')}>
                        {monthDelta >= 0 ? '+' : ''}
                        {monthDelta.toFixed(0)}%
                      </em>
                    </div>
                    <div className="mr-focus-bar">
                      {topTactics.map((c, i) => (
                        <span
                          key={c.id}
                          style={{ width: `${Math.max(8, pct(c.events, observedTotal))}%`, background: [CORAL, '#ffffff', SLATE][i] }}
                        />
                      ))}
                    </div>
                    <div className="mr-focus-legend">
                      {topTactics.map((c, i) => (
                        <span key={c.id}>
                          <i style={{ background: [CORAL, '#ffffff', SLATE][i] }} />
                          {c.id} {pct(c.events, observedTotal).toFixed(0)}%
                        </span>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="mr-strip3">
                  {topTechniques.map((n, i) => (
                    <div key={n.tech.id}>
                      <span className="mr-strip-label">
                        <i style={{ background: [CORAL, NAVY, SLATE][i % 3] }} />
                        {n.tech.name}
                      </span>
                      <span className="mr-strip-value mono">
                        {pct(n.tech.observed, observedTotal).toFixed(1)}% · {count(n.tech.observed, 'event')}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </MrCard>

          <MrCard
            className="mk-matrix-card"
            icon={<Grid3X3 size={15} />}
            title="Enterprise matrix"
            sub={
              <>
                Cell intensity = <strong>{lensDef.label.toLowerCase()}</strong> · {lensDef.note} · click any technique to inspect it
              </>
            }
            actions={
              <>
                <SourceBadge source="MITRE ATT&CK" simulated />
                <span className="badge simulated">offline subset</span>
              </>
            }
            bodyClass="mr-card-body flush"
          >
            <div id="mk-matrix" className="mk-matrix-scroll">
              <div className="mk-matrix" style={{ '--mk-cols': columns.length } as CSSProperties}>
                {columns.map((c, colIndex) => {
                  const visible = c.nodes.filter((n) => matches.has(n.tech.id))
                  const colMax = Math.max(...c.nodes.map(lensValue), 1)
                  return (
                    <div
                      className={cx('mk-col', hoverCol !== null && hoverCol !== colIndex && 'fade')}
                      key={c.id}
                      onMouseEnter={() => setHoverCol(colIndex)}
                      onMouseLeave={() => setHoverCol((h) => (h === colIndex ? null : h))}
                    >
                      <header className="mk-col-head">
                        <div className="mk-col-top">
                          <h4>{c.name}</h4>
                          <span className="mono">{c.events}</span>
                        </div>
                        <span className="mk-col-id mono">{c.id}</span>
                        <span className="mk-col-bar">
                          <span
                            style={
                              {
                                width: `${Math.max(4, pct(c.events, Math.max(...columns.map((x) => x.events))))}%`,
                                '--mr-fill': TACTIC_HUES[colIndex % TACTIC_HUES.length],
                              } as CSSProperties
                            }
                          />
                        </span>
                        <span className="mk-col-owned mono">
                          {c.owned}/{c.nodes.length} owned
                        </span>
                      </header>
                      <div className="mk-col-body">
                        {visible.map((n) => {
                          const h = heat(n)
                          const dim = !inProfile(n)
                          const on = selected?.tech.id === n.tech.id
                          const bricks = Math.round(h * 6)
                          return (
                            <button
                              key={n.tech.id}
                              type="button"
                              className={cx('mk-cell', h > 0.72 && 'hot', dim && 'dim', on && 'sel')}
                              style={
                                {
                                  '--mk-hue': lensDef.hue,
                                  background: hexA(lensDef.hue, 0.05 + h * 0.3),
                                } as CSSProperties
                              }
                              onClick={() => setSelected(n)}
                              aria-label={`${n.tech.id} ${n.tech.name}, ${lensValue(n)} ${lensDef.unit}`}
                            >
                              <span className="mk-cell-bricks" aria-hidden="true">
                                {Array.from({ length: 6 }, (_, i) => (
                                  <i key={i} className={cx(i < bricks && 'on')} style={i < bricks ? { background: lensDef.hue } : undefined} />
                                ))}
                              </span>
                              <span className="mk-cell-name">{n.tech.name}</span>
                              <span className="mk-cell-foot">
                                <span className="mk-cell-id mono">{n.tech.id}</span>
                                <span className="mk-cell-val mono">
                                  {lensValue(n)}
                                  <em>{lensDef.unit === 'events' ? 'ev' : lensDef.unit === 'profiles' ? 'pb' : 'pt'}</em>
                                </span>
                              </span>
                              <span className="mk-cell-dots" aria-hidden="true">
                                {n.profiles.slice(0, 3).map((p) => (
                                  <i key={p.key} style={{ background: levelColor(p.defaultSeverity) }} title={p.name} />
                                ))}
                                {n.profiles.length > 3 && <em className="mono">+{n.profiles.length - 3}</em>}
                                {n.profiles.length === 0 && <em className="mk-unowned mono">unowned</em>}
                              </span>
                              {h >= colMax / lensMax - 0.001 && h > 0.2 && <span className="mk-cell-peak mono">peak</span>}
                            </button>
                          )
                        })}
                        {visible.length === 0 && (
                          <div className="mk-cell empty">
                            <span className="mk-cell-name">{c.nodes.length ? 'no match' : 'not in subset'}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            <div className="mk-legend">
              <span className="mono">LOW</span>
              <span className="mk-scale">
                {[0, 1, 2, 3, 4, 5, 6].map((i) => (
                  <i key={i} style={{ background: hexA(lensDef.hue, 0.05 + (i / 6) * 0.34) }} />
                ))}
              </span>
              <span className="mono">HIGH · {lensMax} {lensDef.unit}</span>
              <span className="mk-legend-sep" />
              <span className="mono">
                <i className="mk-dot" style={{ background: levelColor('CRITICAL') }} /> critical playbook
              </span>
              <span className="mono">
                <i className="mk-dot" style={{ background: levelColor('HIGH') }} /> high
              </span>
              <span className="mono">
                <i className="mk-dot" style={{ background: SLATE }} /> unowned
              </span>
            </div>

            <div className="table-note mk-note-row">
              <span className="inline-flex">
                <Info size={11} /> {columns.length} of fourteen enterprise tactics, {model.length} techniques, 196
                reference records in the real bundle. Only the trimmed set is used here.
              </span>
              <span className="mono">label: simulated reference</span>
            </div>
          </MrCard>

          <div className="dash-grid mr-row">
            <MrCard className="col-4" icon={<Gauge size={15} />} title="Observed share" sub="Mappings distributed across tactics">
              <div className="mr-gauge">
                <Chart option={shareOption} height={172} />
                <div className="mr-gauge-center">
                  <strong>{observedTotal}</strong>
                  <span>total mappings</span>
                </div>
              </div>
              <div className="mr-mini3">
                {topTactics.map((c, i) => (
                  <div key={c.id}>
                    <i className="mr-mini-tick" style={{ background: [CORAL, NAVY, SLATE][i % 3] }} />
                    <strong className="mr-mini-num">{c.events}</strong>
                    <span className="mr-mini-name">{c.name}</span>
                  </div>
                ))}
              </div>
            </MrCard>

            <MrCard
              className="col-4"
              icon={<Crosshair size={15} />}
              title="Coverage quadrant"
              sub="Bubble = exposure pts · shaded band = loud behaviour no playbook owns"
            >
              <Chart option={quadrantOption} height={236} />
            </MrCard>

            <MrCard className="col-4" icon={<RadarIcon size={15} />} title="Tactic pressure" sub="Observed volume vs ownership, indexed to 100">
              <Chart option={radarOption} height={236} />
            </MrCard>
          </div>

          <MrCard
            icon={<Boxes size={15} />}
            title="Technique × playbook incidence"
            sub={`${ownedNodes.length} of ${model.length} techniques are documented by an attack profile · hover a column, click a row`}
            bodyClass="mr-card-body flush"
          >
            <div className="mk-inc-scroll">
              <div className="mk-inc" style={{ '--mk-inc-cols': attackProfiles.length } as CSSProperties}>
                <div className="mk-inc-row mk-inc-head">
                  <span className="mk-inc-corner mono">TECHNIQUE</span>
                  {attackProfiles.map((p, i) => (
                    <button
                      key={p.key}
                      type="button"
                      className={cx('mk-inc-colname', profileKey === p.key && 'on', hoverCol === i && 'hl')}
                      title={`${p.name} · ${p.category}`}
                      onMouseEnter={() => setHoverCol(i)}
                      onMouseLeave={() => setHoverCol((h) => (h === i ? null : h))}
                      onClick={() => setProfileKey((k) => (k === p.key ? null : p.key))}
                      aria-pressed={profileKey === p.key}
                    >
                      <span className="mono">{initials(p.name)}</span>
                      <i style={{ background: levelColor(p.defaultSeverity) }} />
                    </button>
                  ))}
                  <span className="mk-inc-total mono">LINKS</span>
                </div>
                {columns.map((c) =>
                  c.nodes.length === 0 ? null : (
                    <div className="mk-inc-group" key={c.id}>
                      <div className="mk-inc-group-head mono">
                        {c.name} <em>{c.id}</em>
                      </div>
                      {c.nodes.map((n) => (
                        <div
                          className={cx('mk-inc-row', hoverCol !== null && n.profiles[hoverCol] && 'lit')}
                          key={n.tech.id}
                        >
                          <button type="button" className="mk-inc-name" onClick={() => setSelected(n)}>
                            <span className="mono mk-inc-id">{n.tech.id}</span>
                            <span className="mk-inc-tech">{n.tech.name}</span>
                          </button>
                          {attackProfiles.map((p, i) => {
                            const on = p.techniques.includes(n.tech.id)
                            return (
                              <span
                                key={p.key}
                                className={cx('mk-inc-cell', on && 'on', hoverCol === i && 'hl')}
                                title={on ? `${p.name} maps ${n.tech.id}` : `${p.name} does not map ${n.tech.id}`}
                              >
                                {on && <i />}
                              </span>
                            )
                          })}
                          <span className="mk-inc-count mono">{n.profiles.length}</span>
                        </div>
                      ))}
                    </div>
                  ),
                )}
                <div className="mk-inc-row mk-inc-foot">
                  <span className="mk-inc-corner mono">TECHNIQUES MAPPED</span>
                  {attackProfiles.map((p) => (
                    <span key={p.key} className="mk-inc-colfoot mono">
                      {p.techniques.filter((id) => model.some((n) => n.tech.id === id)).length}
                    </span>
                  ))}
                  <span className="mk-inc-total mono">{sum(attackProfiles.map((p) => p.techniques.filter((id) => model.some((n) => n.tech.id === id)).length))}</span>
                </div>
              </div>
            </div>
            <div className="mr-indicators">
              <span className="mr-ind-label mono">HOW TO READ THIS</span>
              <p className="mk-inc-note">
                Every brick is a real link in the reference set: a filled cell means that attack profile documents the technique on
                that row. Empty cells are gaps in the playbook set, not evidence that the behaviour is impossible.
              </p>
            </div>
          </MrCard>

          <MrCard
            icon={<ShieldCheck size={15} />}
            title="Technique register"
            sub={`${registerRows.length} of ${model.length} techniques${activeProfile ? ` · ${activeProfile.name} overlay` : ''}`}
            bodyClass="mr-card-body flush"
          >
            <div className="table-wrap">
              <table className="data-table mr-table mk-register">
                <colgroup>
                  <col className="c-rank" />
                  <col className="c-tech" />
                  <col className="c-tactic" />
                  <col className="c-desc" />
                  <col className="c-val" />
                  <col className="c-bar" />
                  <col className="c-pb" />
                </colgroup>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Technique</th>
                    <th>Tactic</th>
                    <th>Description</th>
                    <th className="right">{lensDef.label}</th>
                    <th>Intensity</th>
                    <th>Playbooks</th>
                  </tr>
                </thead>
                <tbody>
                  {registerRows.map((n, i) => (
                    <tr key={n.tech.id} className="clickable" onClick={() => setSelected(n)}>
                      <td className="mono mk-rank">{i + 1}</td>
                      <td>
                        <div className="cell-title mono">{n.tech.id}</div>
                        <div className="cell-sub">{n.tech.name}</div>
                      </td>
                      <td>
                        <span className="cell-sub">{n.tech.tactic}</span>
                      </td>
                      <td>
                        <span className="cell-sub">{n.tech.description}</span>
                      </td>
                      <td className="right mono">
                        {lensValue(n)} <em className="mk-unit">{unitFor(lensValue(n), lensDef.unit)}</em>
                      </td>
                      <td>
                        <span className="mk-lead-bar">
                          <span
                            style={
                              {
                                width: `${Math.max(3, (lensValue(n) / lensMax) * 100)}%`,
                                '--mr-fill': lensDef.hue,
                              } as CSSProperties
                            }
                          />
                        </span>
                      </td>
                      <td>
                        <div className="inline-flex" style={{ flexWrap: 'wrap', gap: 4 }}>
                          {n.profiles.map((p) => (
                            <span className="badge" key={p.key} style={{ fontSize: 7.5 }}>
                              {p.name}
                            </span>
                          ))}
                          {!n.profiles.length && <span className="badge simulated">unowned</span>}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {registerRows.length === 0 && (
                    <tr>
                      <td colSpan={7} className="mk-no-rows">
                        No technique matches “{query}”{activeProfile ? ` inside ${activeProfile.name}` : ''}. Clear a filter to
                        bring the grid back.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </MrCard>

          <StatsPanel
            stats={[
              { name: 'Techniques per tactic', value: (model.length / columns.length).toFixed(2), formula: 'techniques ÷ tactics', n: model.length },
              { name: 'Mean observations', value: (observedTotal / model.length).toFixed(2), formula: 'Σ observed ÷ techniques', n: model.length },
              { name: 'Playbook coverage', value: `${coveragePct.toFixed(0)}%`, formula: 'techniques with ≥1 profile ÷ techniques', n: model.length },
              { name: 'Events inside a playbook', value: `${ownedEvents}/${observedTotal}`, formula: 'Σ observed where linked profiles exist', n: model.length },
              { name: 'Largest tactic', value: `${[...columns].sort((a, b) => b.events - a.events)[0].name}`, formula: 'max observed events', n: columns.length },
            ]}
          />
        </div>
      </div>

      <div className="page-foot">
        <span className="inline-flex">
          <Crosshair size={11} /> ATT&amp;CK content is a trimmed, clearly labelled offline subset.
        </span>
        <span className="inline-flex">
          <Sparkles size={11} /> The monthly spread is an illustrative shape that sums to the observed total, not telemetry.
        </span>
      </div>

      <TechniqueWorkbench
        node={selected}
        ctx={workbenchCtx}
        lensKey={lens}
        onClose={() => setSelected(null)}
        onOpen={setSelected}
        onProfile={(key) => setProfileKey((current) => (current === key ? null : key))}
      />
    </div>
  )
}
