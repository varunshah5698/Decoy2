import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { Chart } from '../../components/Chart'
import { PageHeader } from '../../components/Panel'
import { StatsPanel } from '../../components/StatsPanel'
import { SeverityBadge } from '../../components/Badges'
import {
  ArrowRight,
  BarChart3,
  ChevronDown,
  Crosshair,
  Gauge,
  Layers,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Swords,
  TrendingUp,
} from '../../components/Icons'
import { attackProfiles, mitreTactics } from '../../data/seed'
import { useEstate } from '../../lib/estate'
import { useTheme } from '../../lib/store'
import { hexA, levelColor } from '../../lib/colors'
import { cx } from '../../lib/format'
import type { AttackProfile, Technique } from '../../lib/types'

const NAVY = '#1b2437'
const CORAL = '#f2683c'
const SLATE = '#97a3b4'
const MUTED = '#8b97a9'
const AXIS = 'rgba(27, 36, 55, 0.1)'
const ON_DARK = [CORAL, '#ffffff', 'rgba(255, 255, 255, 0.45)']

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']

const sigla = (name: string) => {
  const words = name.split(/[\s-]+/).filter(Boolean)
  return (words.length > 1 ? words.map((w) => w[0]).join('') : name.slice(0, 2)).toUpperCase().slice(0, 3)
}

const pct = (value: number, total: number) => (total > 0 ? (value / total) * 100 : 0)

const count = (value: number, word: string) => `${value.toLocaleString('en-US')} ${word}${value === 1 ? '' : 's'}`

type SegmentKey = 'techniques' | 'stages' | 'owners'

const SEGMENTS: { key: SegmentKey; label: string; unit: string }[] = [
  { key: 'techniques', label: 'Techniques', unit: 'event' },
  { key: 'stages', label: 'Stages', unit: 'event' },
  { key: 'owners', label: 'Owners', unit: 'control' },
]

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

function ProfileSelect({
  value,
  onChange,
}: {
  value: AttackProfile
  onChange: (key: string) => void
}) {
  const [open, setOpen] = useState(false)
  const wrap = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointer = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="mr-select-wrap" ref={wrap}>
      <button
        type="button"
        className="mr-select"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Attack profile: ${value.name}. Change profile`}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="mr-select-avatar" aria-hidden="true">
          {sigla(value.name)}
        </span>
        <span className="mr-select-copy">
          <strong>{value.name}</strong>
          <span>
            {value.category} · {value.techniques.length} techniques
          </span>
        </span>
        <ChevronDown size={15} className={cx('mr-select-caret', open && 'open')} />
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            className="mr-menu"
            role="listbox"
            aria-label="Attack profiles"
            initial={{ opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.98 }}
            transition={{ duration: 0.16, ease: 'easeOut' }}
          >
            {attackProfiles.map((p) => (
              <button
                key={p.key}
                type="button"
                role="option"
                aria-selected={p.key === value.key}
                className={cx('mr-menu-item', p.key === value.key && 'on')}
                onClick={() => {
                  onChange(p.key)
                  setOpen(false)
                }}
              >
                <i className="mr-dot" style={{ background: levelColor(p.defaultSeverity) }} />
                <span className="mr-menu-copy">
                  <strong>{p.name}</strong>
                  <span>{p.category}</span>
                </span>
                <em className="mono">{p.techniques.length}</em>
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export default function Attacks() {
  const setTheme = useTheme((s) => s.setTheme)
  const reduceMotion = useReducedMotion()
  const estate = useEstate()
  const year = new Date(estate.now).getUTCFullYear()

  // MoonRow surface: the cool-white skin is what makes the coral/navy analytics
  // legible, so the page opts into it for the duration of its mount, the same way
  // the network graph does.
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

  const [selectedKey, setSelectedKey] = useState(attackProfiles[0].key)
  const [segment, setSegment] = useState<SegmentKey>('techniques')
  const profile = attackProfiles.find((p) => p.key === selectedKey) ?? attackProfiles[0]
  const openRow = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    openRow.current?.scrollIntoView({ block: 'nearest' })
  }, [selectedKey])

  const linked = useMemo(
    () => profile.techniques.map((id) => estate.techniques.find((t) => t.id === id)).filter(Boolean) as Technique[],
    [profile, estate],
  )
  const observedTotal = linked.reduce((a, t) => a + t.observed, 0)

  const bars = useMemo(() => {
    const byTechnique = linked.map((t) => ({ name: t.name, meta: t.id, value: t.observed }))
    const byStage = profile.stages.map((s) => ({
      name: s.tactic,
      meta: s.note,
      value: linked.filter((t) => t.tactic === s.tactic).reduce((a, b) => a + b.observed, 0),
    }))
    const owners: Record<string, number> = {}
    profile.mitigations.forEach((m) => {
      owners[m.team] = (owners[m.team] ?? 0) + 1
    })
    const byOwner = Object.entries(owners).map(([team, n]) => ({
      name: team,
      meta: `${n} control${n > 1 ? 's' : ''}`,
      value: n,
    }))
    return { techniques: byTechnique, stages: byStage, owners: byOwner }
  }, [profile, linked])

  const barItems = bars[segment]
  const barSum = barItems.reduce((a, b) => a + b.value, 0)
  const barMax = Math.max(...barItems.map((b) => b.value), 1)
  const unit = SEGMENTS.find((s) => s.key === segment)!.unit

  const trend = useMemo(() => {
    // Shape is derived from the profile key so it is stable across renders; it is a
    // planning curve, not observed telemetry, and is labelled as such in the card.
    const salt = profile.key.split('').reduce((a, c) => a + c.charCodeAt(0), 0)
    const base = Math.max(2, observedTotal)
    const series = MONTHS.map((_, i) =>
      Math.max(1, Math.round(base * (0.72 + Math.sin((i + salt) / 2.1) * 0.26 + Math.cos((i * 1.7 + salt) / 3.4) * 0.18) * (1 + i * 0.03))),
    )
    const peakIndex = series.indexOf(Math.max(...series))
    const first = series[0]
    return {
      series,
      peakIndex,
      peak: series[peakIndex],
      delta: first > 0 ? ((series[series.length - 1] - first) / first) * 100 : 0,
    }
  }, [profile, observedTotal])

  const trendOption = useMemo(
    () => ({
      grid: { left: 8, right: 12, top: 18, bottom: 22, containLabel: true },
      xAxis: {
        type: 'category',
        boundaryGap: false,
        data: MONTHS,
        axisLine: { lineStyle: { color: AXIS } },
        axisTick: { show: false },
        axisLabel: { color: MUTED, fontSize: 8.5, fontFamily: 'JetBrains Mono Variable, monospace' },
      },
      yAxis: {
        type: 'value',
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { color: MUTED, fontSize: 8.5, fontFamily: 'JetBrains Mono Variable, monospace' },
        splitLine: { lineStyle: { color: AXIS, type: 'dashed' } },
      },
      tooltip: { trigger: 'axis' },
      series: [
        {
          type: 'line',
          data: trend.series,
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
                { offset: 0, color: hexA(CORAL, 0.24) },
                { offset: 1, color: hexA(CORAL, 0.01) },
              ],
            },
          },
          markPoint: {
            symbol: 'circle',
            symbolSize: 10,
            data: [{ coord: [trend.peakIndex, trend.peak] }],
            itemStyle: { color: NAVY, borderColor: '#fff', borderWidth: 2 },
            label: { show: false },
          },
          markLine: {
            symbol: 'none',
            silent: true,
            label: { show: false },
            lineStyle: { color: hexA(NAVY, 0.3), type: 'dashed', width: 1 },
            data: [{ xAxis: trend.peakIndex }],
          },
        },
      ],
    }),
    [trend],
  )

  const shareOption = useMemo(
    () => ({
      tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
      series: [
        {
          type: 'pie',
          radius: ['62%', '86%'],
          center: ['50%', '76%'],
          startAngle: 180,
          endAngle: 0,
          minAngle: 6,
          padAngle: 2,
          label: { show: false },
          labelLine: { show: false },
          itemStyle: { borderColor: '#fff', borderWidth: 2, borderRadius: 4 },
          data: linked.map((t, i) => ({
            name: t.name,
            value: t.observed,
            itemStyle: { color: [CORAL, NAVY, SLATE, hexA(CORAL, 0.45)][i % 4] },
          })),
        },
      ],
    }),
    [linked],
  )

  const radarOption = useMemo(() => {
    const values = mitreTactics.map((t) => {
      const stage = profile.stages.some((s) => s.tactic === t.name)
      const techs = linked.filter((x) => x.tacticId === t.id).length
      return (stage ? 1 : 0) + techs * 0.6
    })
    return {
      radar: {
        indicator: mitreTactics.map((t) => ({ name: t.name, max: 2.2 })),
        radius: '64%',
        splitNumber: 3,
        axisName: { color: MUTED, fontSize: 8, fontFamily: 'JetBrains Mono Variable, monospace' },
        splitLine: { lineStyle: { color: AXIS } },
        splitArea: { areaStyle: { color: ['transparent', 'rgba(27,36,55,.025)'] } },
        axisLine: { lineStyle: { color: AXIS } },
      },
      tooltip: {},
      series: [
        {
          type: 'radar',
          data: [
            {
              value: values,
              name: profile.name,
              symbolSize: 4,
              lineStyle: { color: CORAL, width: 1.8 },
              itemStyle: { color: CORAL },
              areaStyle: { color: hexA(CORAL, 0.14) },
            },
          ],
        },
      ],
    }
  }, [profile, linked])

  const weightOption = useMemo(
    () => ({
      grid: { left: 6, right: 18, top: 8, bottom: 4, containLabel: true },
      xAxis: {
        type: 'value',
        axisLabel: { color: MUTED, fontSize: 8, fontFamily: 'JetBrains Mono Variable, monospace' },
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { show: false },
      },
      yAxis: {
        type: 'category',
        data: attackProfiles.map((p) => p.name),
        axisLine: { lineStyle: { color: AXIS } },
        axisTick: { show: false },
        axisLabel: { color: MUTED, fontSize: 8.5, fontFamily: 'JetBrains Mono Variable, monospace' },
      },
      tooltip: { trigger: 'item', formatter: (p: any) => `${p.name}: ${p.value.toFixed(1)} weight` },
      series: [
        {
          type: 'bar',
          barWidth: '62%',
          itemStyle: { borderRadius: [0, 6, 6, 0] },
          data: attackProfiles.map((p) => ({
            value: p.techniques.length + p.stages.length * 0.5,
            itemStyle: { color: p.key === selectedKey ? CORAL : hexA(NAVY, 0.16) },
          })),
        },
      ],
    }),
    [selectedKey],
  )

  const topTechniques = [...linked].sort((a, b) => b.observed - a.observed).slice(0, 3)

  return (
    <div className="page">
      <PageHeader
        eyebrow="COMPONENT 05 · ATTACK PROFILES"
        title="From technique to mitigation"
        description="Ten attack patterns, each mapped to MITRE ATT&CK stages and to controls that a named team can actually own."
        actions={
          <a className="btn btn-ghost btn-sm" href="https://attack.mitre.org/" target="_blank" rel="noreferrer">
            ATT&amp;CK <ArrowRight size={13} />
          </a>
        }
      />

      <div className="mr-grid">
        <aside className="mr-rail">
          <MrCard
            icon={<Swords size={15} />}
            title="Attack profile"
            sub="Pick a pattern to open its chain"
          >
            <ProfileSelect value={profile} onChange={setSelectedKey} />

            <div className="mr-acc">
              {attackProfiles.map((p) => {
                const on = p.key === selectedKey
                return (
                  <div className={cx('mr-acc-item', on && 'on')} key={p.key}>
                    <button
                      type="button"
                      ref={on ? openRow : undefined}
                      className="mr-acc-head"
                      aria-expanded={on}
                      onClick={() => setSelectedKey(p.key)}
                    >
                      <i className="mr-dot" style={{ background: levelColor(p.defaultSeverity) }} />
                      <strong>{p.name}</strong>
                      <span className="mono mr-acc-meta">{p.stages.length} stages</span>
                      <ChevronDown size={14} className={cx('mr-acc-caret', on && 'open')} />
                    </button>
                    <AnimatePresence initial={false}>
                      {on && (
                        <motion.div
                          className="mr-acc-body"
                          initial={reduceMotion ? { opacity: 0 } : { height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={reduceMotion ? { opacity: 0 } : { height: 0, opacity: 0 }}
                          transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                        >
                          <p>{p.description}</p>
                          <dl>
                            <div>
                              <dt>Severity</dt>
                              <dd>
                                <SeverityBadge level={p.defaultSeverity} />
                              </dd>
                            </div>
                            <div>
                              <dt>Techniques</dt>
                              <dd className="mono">{p.techniques.join(' · ')}</dd>
                            </div>
                            <div>
                              <dt>Controls</dt>
                              <dd className="mono">{p.mitigations.length} owned</dd>
                            </div>
                          </dl>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                )
              })}
            </div>
          </MrCard>
        </aside>

        <div className="mr-main">
          <MrCard
            className="mr-breakdown"
            icon={<BarChart3 size={15} />}
            title={`${profile.name} breakdown`}
            sub="Illustrative 12-month exposure curve · shaped by this profile's technique weights"
            actions={
              <div className="mr-seg" role="group" aria-label="Breakdown dimension">
                {SEGMENTS.map((s) => (
                  <button
                    key={s.key}
                    type="button"
                    className={cx(segment === s.key && 'on')}
                    aria-pressed={segment === s.key}
                    onClick={() => setSegment(s.key)}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            }
          >
            <div className="mr-bd-body">
              <div className="mr-bd-left">
                <div className="mr-bignum">
                  {observedTotal.toLocaleString('en-US')}
                  <span className="mr-bignum-tick" aria-hidden="true">
                    <TrendingUp size={14} />
                  </span>
                </div>
                <div className="mr-bignum-label">
                  Linked event volume · <SeverityBadge level={profile.defaultSeverity} />
                </div>

                <div className="mr-bars">
                  {barItems.map((b, i) => (
                    <div className="mr-bar-row" key={`${b.name}-${b.meta}`}>
                      <div className="mr-bar-name">
                        <i className="mr-bar-tick" style={{ background: i === 0 ? CORAL : NAVY }} />
                        {b.name}
                      </div>
                      <div className="mr-bar-track">
                        <span
                          className="mr-bar-fill"
                          style={
                            {
                              width: `${Math.max(4, (b.value / barMax) * 100)}%`,
                              '--mr-fill': i === 0 ? CORAL : NAVY,
                            } as CSSProperties
                          }
                        />
                      </div>
                      <div className="mr-bar-meta">
                        <strong>{pct(b.value, barSum).toFixed(1)}%</strong>
                        <span className="mono"> · {count(b.value, unit)}</span>
                      </div>
                      <div className="mr-bar-sub mono">{b.meta}</div>
                    </div>
                  ))}
                  {barSum === 0 && (
                    <p className="mr-bars-note">
                      No technique in this profile maps to a stage tactic in the trimmed ATT&amp;CK subset, so every
                      stage carries zero observed events.
                    </p>
                  )}
                </div>
              </div>

              <div className="mr-bd-right">
                <div className="mr-chart">
                  <Chart option={trendOption} height={252} />
                  <div
                    className="mr-focus"
                    aria-hidden="true"
                    style={{ left: `max(12px, calc(${(trend.peakIndex / (MONTHS.length - 1)) * 100}% - 208px))` }}
                  >
                    <span className="mr-focus-date">
                      {MONTHS[trend.peakIndex]} {year} · peak
                    </span>
                    <div className="mr-focus-value">
                      {trend.peak}
                      <small>events</small>
                      <em className={cx('mr-focus-delta', trend.delta >= 0 ? 'up' : 'down')}>
                        {trend.delta >= 0 ? '+' : ''}
                        {trend.delta.toFixed(0)}%
                      </em>
                    </div>
                    <div className="mr-focus-bar">
                      {topTechniques.map((t, i) => (
                        <span
                          key={t.id}
                          style={{
                            width: `${Math.max(8, pct(t.observed, observedTotal))}%`,
                            background: ON_DARK[i % 3],
                          }}
                        />
                      ))}
                    </div>
                    <div className="mr-focus-legend">
                      {topTechniques.map((t, i) => (
                        <span key={t.id}>
                          <i style={{ background: ON_DARK[i % 3] }} />
                          {t.id} {pct(t.observed, observedTotal).toFixed(0)}%
                        </span>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="mr-strip3">
                  {topTechniques.map((t, i) => (
                    <div key={t.id}>
                      <span className="mr-strip-label">
                        <i style={{ background: [CORAL, NAVY, SLATE][i % 3] }} />
                        {t.name}
                      </span>
                      <span className="mr-strip-value mono">
                        {pct(t.observed, observedTotal).toFixed(1)}% · {count(t.observed, 'event')}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </MrCard>

          <MrCard
            icon={<Layers size={15} />}
            title="Kill chain"
            sub={`${profile.stages.length} stages · ${profile.category}`}
            bodyClass="mr-card-body flush"
          >
            <ol className="mr-steps">
              {profile.stages.map((s, i) => (
                <li key={`${s.tactic}-${i}`}>
                  <span className="mr-step-num mono">{String(i + 1).padStart(2, '0')}</span>
                  <div className="mr-step-copy">
                    <strong>{s.tactic}</strong>
                    <p>{s.note}</p>
                  </div>
                </li>
              ))}
            </ol>
          </MrCard>

          <div className="dash-grid mr-row">
            <MrCard
              className="col-5"
              icon={<Gauge size={15} />}
              title="Signal share"
              sub="Linked events by technique"
            >
              <div className="mr-gauge">
                <Chart option={shareOption} height={172} />
                <div className="mr-gauge-center">
                  <strong>{observedTotal}</strong>
                  <span>total events</span>
                </div>
              </div>
              <div className="mr-mini3">
                {topTechniques.map((t, i) => (
                  <div key={t.id}>
                    <i className="mr-mini-tick" style={{ background: [CORAL, NAVY, SLATE][i % 3] }} />
                    <strong className="mr-mini-num">{t.observed}</strong>
                    <span className="mr-mini-name">{t.id}</span>
                  </div>
                ))}
              </div>
            </MrCard>

            <MrCard
              className="col-7"
              icon={<SlidersHorizontal size={15} />}
              title="Tactic coverage"
              sub="Stage presence plus mapped technique weight"
            >
              <Chart option={radarOption} height={268} />
            </MrCard>

            <MrCard
              className="col-5"
              icon={<BarChart3 size={15} />}
              title="Profile weight"
              sub="Techniques plus half-weighted stages"
            >
              <Chart option={weightOption} height={262} />
            </MrCard>

            <MrCard
              className="col-7"
              icon={<ShieldCheck size={15} />}
              title="Mitigations"
              sub="Each control carries an owning team"
              actions={<span className="badge low">{profile.mitigations.length} controls</span>}
            >
              <ul className="mr-mitigations">
                {profile.mitigations.map((m, i) => (
                  <li key={m.control}>
                    <span className="mono mr-mit-num">{String(i + 1).padStart(2, '0')}</span>
                    <span className="mr-mit-control">{m.control}</span>
                    <span className="mr-mit-team">{m.team}</span>
                  </li>
                ))}
              </ul>
              <div className="mr-why">
                <div className="inline-flex">
                  <ShieldCheck size={13} className="check" />
                  <strong>Why this matters</strong>
                </div>
                <p>
                  The profile is a planning artefact. It does not claim this organisation observed the attack; it links
                  observed techniques to the controls that would interrupt the chain.
                </p>
              </div>
            </MrCard>
          </div>

          <MrCard
            icon={<Crosshair size={15} />}
            title="Techniques linked to this profile"
            sub={`${linked.length} of ${profile.techniques.length} mapped in the trimmed ATT&CK subset`}
            bodyClass="mr-card-body flush"
          >
            <div className="table-wrap">
              <table className="data-table mr-table">
                <thead>
                  <tr>
                    <th>Technique</th>
                    <th>Tactic</th>
                    <th>Description</th>
                    <th className="right">Observed</th>
                    <th className="right">Share</th>
                  </tr>
                </thead>
                <tbody>
                  {linked.map((t) => (
                    <tr key={t.id}>
                      <td>
                        <div className="cell-title mono">{t.id}</div>
                        <div className="cell-sub">{t.name}</div>
                      </td>
                      <td className="cell-sub">{t.tactic}</td>
                      <td className="cell-sub">{t.description}</td>
                      <td className="right mono">{t.observed}</td>
                      <td className="right">
                        <span className="mr-share mono">{pct(t.observed, observedTotal).toFixed(0)}%</span>
                      </td>
                    </tr>
                  ))}
                  {profile.techniques
                    .filter((id) => !estate.techniques.some((x) => x.id === id))
                    .map((id) => (
                      <tr key={id} className="suppressed-row">
                        <td>
                          <div className="cell-title mono">{id}</div>
                          <div className="cell-sub">Not in the trimmed demo subset</div>
                        </td>
                        <td className="cell-sub">—</td>
                        <td className="cell-sub">—</td>
                        <td className="right mono">—</td>
                        <td className="right mono">—</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            <div className="mr-indicators">
              <span className="mr-ind-label mono">INDICATORS TO HUNT</span>
              <div className="entity-tags">
                {profile.indicators.map((i) => (
                  <span className="entity-tag" key={i}>
                    {i}
                  </span>
                ))}
              </div>
            </div>
          </MrCard>

          <StatsPanel
            stats={[
              {
                name: 'Profiles',
                value: String(attackProfiles.length),
                formula: 'attack_profiles rows',
                n: attackProfiles.length,
              },
              {
                name: 'Mean stages',
                value: (attackProfiles.reduce((a, b) => a + b.stages.length, 0) / attackProfiles.length).toFixed(1),
                formula: 'stages ÷ profiles',
                n: attackProfiles.length,
              },
              {
                name: 'Linked techniques',
                value: `${linked.length}/${profile.techniques.length}`,
                formula: 'present in trimmed ATT&CK subset',
                n: profile.techniques.length,
              },
              {
                name: 'Total techniques in subset',
                value: String(estate.techniques.length),
                formula: 'technique rows',
                n: estate.techniques.length,
              },
              {
                name: 'Observed events',
                value: String(estate.techniques.reduce((a, b) => a + b.observed, 0)),
                formula: 'sum of technique observed counts',
                n: estate.techniques.length,
              },
            ]}
          />
        </div>
      </div>

      <div className="page-foot">
        <span className="inline-flex">
          <Crosshair size={11} /> ATT&amp;CK content is a trimmed, clearly labelled offline subset.
        </span>
        <span className="inline-flex">
          <Sparkles size={11} /> The exposure curve is an illustrative shape, not observed telemetry.
        </span>
      </div>
    </div>
  )
}
