import { useMemo, useState, type CSSProperties } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Drawer, DrawerHead } from '../../components/Drawer'
import { Panel } from '../../components/Panel'
import { Chart, axisStyle, chartFont, chartTokens } from '../../components/Chart'
import { Counter } from '../../components/Counter'
import { McHead, MoonGauge } from '../../components/MoonCards'
import { StatsPanel } from '../../components/StatsPanel'
import { BoardComposition, BoardDial, BoardFactors, BoardMeter, levelColor, levelLabel } from '../../components/BoardDetail'
import { SeverityBadge, ConfidenceBadge, RelevanceBadge } from '../../components/Badges'
import { EmptyState } from '../../components/EmptyState'
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Check,
  Download,
  Gauge,
  Globe2,
  Layers,
  Lock,
  Search,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  X,
} from '../../components/Icons'
import { DEMO_NOW } from '../../data/seed'
import { useAcks, useAuth, useFilters, useTheme, useToast } from '../../lib/store'
import { cx, fmtDate, fmtPct, fmtScore, timeAgo } from '../../lib/format'
import { median } from '../../lib/stats'
import { relevanceReason } from '../../lib/scoring'
import { ML_BANDS, predict } from '../../lib/ml'
import { useLiveActiveAlerts, useLiveAlerts, useLiveSuppressedAlerts } from '../../lib/liveData'
import { entryStatus, useActions } from '../../lib/actionStore'
import {
  WARNING_STAGES,
  buildRecommendations,
  stageMeta,
  warningStageFor,
  type WarningStage,
} from '../../lib/warnings'
import { LEVEL_COLORS, hexA } from '../../lib/colors'
import type { Alert, RelevanceStatus, RiskLevel } from '../../lib/types'

type RelevanceFilter = 'ALL' | RelevanceStatus

const LEVELS: RiskLevel[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']

const AGE_BANDS = [
  { label: '≤ 6h', min: -Infinity, max: 6 },
  { label: '6–24h', min: 6, max: 24 },
  { label: '24–48h', min: 24, max: 48 },
  { label: '48–72h', min: 48, max: 72 },
  { label: '72h+', min: 72, max: Infinity },
]

export default function Alerts() {
  const [params, setParams] = useSearchParams()
  const query = useFilters((s) => s.query)
  const setQuery = useFilters((s) => s.setQuery)
  const toast = useToast((s) => s.show)
  const session = useAuth((s) => s.session)
  const admin = session?.role === 'ADMIN'
  const acks = useAcks((s) => s.acks)
  const ack = useAcks((s) => s.ack)

  const alerts = useLiveAlerts()
  const activeAlerts = useLiveActiveAlerts()
  const suppressedAlerts = useLiveSuppressedAlerts()

  const [level, setLevel] = useState<'ALL' | RiskLevel>('ALL')
  const [relevance, setRelevance] = useState<RelevanceFilter>('ALL')
  const [showSuppressed, setShowSuppressed] = useState(true)
  const [kevOnly, setKevOnly] = useState(false)

  const navigate = useNavigate()
  const actionEntries = useActions((s) => s.entries)
  const recommendations = useMemo(() => buildRecommendations(alerts), [alerts])
  const selectedId = params.get('alert')
  const selected = selectedId ? alerts.find((a) => a.id === selectedId) ?? null : null
  const selectedActions = selected ? recommendations.filter((r) => r.alertId === selected.id) : []
  const selectedStage: WarningStage = selected
    ? warningStageFor(selected, {
        acknowledged: Boolean(acks[selected.id]),
        actionStatuses: selectedActions.map((r) => entryStatus(actionEntries, r.id)),
      })
    : 'EMERGING'
  const selectedOpenActions = selectedActions.filter(
    (r) => entryStatus(actionEntries, r.id) !== 'VERIFIED',
  ).length

  const open = (a: Alert) => {
    const next = new URLSearchParams(params)
    next.set('alert', a.id)
    setParams(next, { replace: true })
  }
  const close = () => {
    const next = new URLSearchParams(params)
    next.delete('alert')
    setParams(next, { replace: true })
  }

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return alerts
      .filter((a) => (showSuppressed ? true : !a.suppressed))
      .filter((a) => (level === 'ALL' ? true : a.level === level))
      .filter((a) => (relevance === 'ALL' ? true : a.relevance === relevance))
      .filter((a) => (kevOnly ? a.cve.kev : true))
      .filter((a) =>
        q ? `${a.id} ${a.cve.id} ${a.cve.title} ${a.asset.name} ${a.asset.department}`.toLowerCase().includes(q) : true,
      )
      .sort((a, b) => Number(a.suppressed) - Number(b.suppressed) || b.score - a.score)
  }, [alerts, level, relevance, showSuppressed, kevOnly, query])

  const theme = useTheme((s) => s.theme)
  const gaugeColors =
    theme === 'dark'
      ? ['#ff6a36', '#a9c2da', '#6f8499', '#465b70']
      : ['#ff5a1f', '#14263e', '#8d99a8', '#c0c7d0']

  const levelCounts = LEVELS.map((level) => ({
    level,
    value: activeAlerts.filter((a) => a.level === level).length,
  }))
  const levelShares = levelCounts.map((l) => ({
    ...l,
    share: (l.value / Math.max(1, activeAlerts.length)) * 100,
  }))
  const matchedCount = activeAlerts.filter((a) => a.relevance === 'MATCHED').length
  const kevActive = activeAlerts.filter((a) => a.cve.kev).length
  const ackedActive = activeAlerts.filter((a) => Boolean(acks[a.id])).length

  const relevanceRows = [
    { label: 'Version confirmed', value: matchedCount, color: gaugeColors[0] },
    { label: 'Version unverified', value: alerts.filter((a) => a.relevance === 'VERSION_UNKNOWN').length, color: gaugeColors[1] },
    { label: 'Not affected', value: alerts.filter((a) => a.relevance === 'NOT_AFFECTED').length, color: gaugeColors[2] },
    { label: 'Product absent', value: alerts.filter((a) => a.relevance === 'PRODUCT_ABSENT').length, color: gaugeColors[3] },
  ].map((r) => ({ ...r, share: (r.value / Math.max(1, alerts.length)) * 100 }))

  const deptRows = useMemo(() => {
    const map = new Map<string, { count: number; level: RiskLevel }>()
    activeAlerts.forEach((a) => {
      const current = map.get(a.asset.department)
      if (!current) map.set(a.asset.department, { count: 1, level: a.level })
      else {
        current.count += 1
        if (LEVELS.indexOf(a.level) < LEVELS.indexOf(current.level)) current.level = a.level
      }
    })
    const palette = [...gaugeColors, theme === 'dark' ? '#46c08a' : '#2fa978', '#e0a12f']
    return [...map.entries()]
      .map(([name, v], i) => ({
        name,
        count: v.count,
        share: (v.count / Math.max(1, activeAlerts.length)) * 100,
        color: palette[i % palette.length],
      }))
      .sort((a, b) => b.count - a.count)
  }, [activeAlerts, gaugeColors, theme])

  const { cohortMatrix, medianAge, oldestAge } = useMemo(() => {
    const ages = activeAlerts.map((a) => ({
      level: a.level,
      hours: (DEMO_NOW.getTime() - new Date(a.createdAt).getTime()) / 3_600_000,
    }))
    return {
      cohortMatrix: AGE_BANDS.map((band) =>
        LEVELS.map(
          (level) => ages.filter((e) => e.level === level && e.hours > band.min && e.hours <= band.max).length,
        ),
      ),
      medianAge: ages.length ? Math.round(median(ages.map((e) => e.hours))) : 0,
      oldestAge: ages.length ? Math.round(Math.max(...ages.map((e) => e.hours))) : 0,
    }
  }, [activeAlerts])

  const riskOption = useMemo(() => {
    const ax = axisStyle(theme, { split: true })
    const t = chartTokens(theme)
    const ranked = activeAlerts.slice().sort((a, b) => b.score - a.score)
    const line = theme === 'dark' ? '#ff8a5c' : '#ff5a1f'
    const bar = theme === 'dark' ? '#a9c2da' : '#14263e'
    const tipBg = theme === 'dark' ? 'rgba(12,18,30,0.97)' : '#14263e'
    return {
      grid: { left: 34, right: 18, top: 26, bottom: 26 },
      xAxis: {
        type: 'category',
        data: ranked.map((_, i) => `#${i + 1}`),
        ...ax,
        axisLabel: { ...ax.axisLabel, interval: 0, fontSize: 9 },
        axisPointer: { label: { show: false } },
      },
      yAxis: { type: 'value', max: 100, ...ax, splitNumber: 4, axisLabel: { ...ax.axisLabel, fontSize: 9 } },
      tooltip: {
        trigger: 'axis',
        backgroundColor: tipBg,
        borderWidth: 0,
        padding: [10, 12],
        textStyle: { color: '#ffffff', fontSize: 10.5, fontFamily: chartFont, lineHeight: 18 },
        extraCssText: 'border-radius:12px;box-shadow:0 20px 40px -18px rgba(16,24,40,.45);',
        axisPointer: {
          type: 'cross',
          lineStyle: { color: hexA(line, 0.45), width: 1, type: 'dashed' },
          crossStyle: { color: hexA(line, 0.45), width: 1, type: 'dashed' },
          label: { show: false },
        },
        formatter: (params: any[]) => {
          const i = params[0]?.dataIndex ?? 0
          const a = ranked[i]
          if (!a) return ''
          return `<div style="font-weight:600;margin-bottom:6px">${a.cve.id} · ${a.asset.name}</div>
            <div style="display:flex;gap:16px;justify-content:space-between"><span>Risk score</span><b>${fmtScore(a.score)}</b></div>
            <div style="display:flex;gap:16px;justify-content:space-between"><span>EPSS</span><b>${a.cve.epss == null ? '—' : fmtPct(a.cve.epss)}</b></div>
            <div style="display:flex;gap:16px;justify-content:space-between"><span>Level</span><b>${a.level}</b></div>`
        },
      },
      series: [
        {
          name: 'EPSS',
          type: 'bar',
          data: ranked.map((a) => Number((((a.cve.epss ?? 0) * 100).toFixed(1)))),
          barWidth: '36%',
          z: 1,
          itemStyle: { borderRadius: [5, 5, 0, 0], color: hexA(bar, theme === 'dark' ? 0.42 : 0.16) },
          emphasis: { itemStyle: { color: hexA(bar, theme === 'dark' ? 0.7 : 0.34) } },
          animationDelay: (idx: number) => idx * 24,
        },
        {
          name: 'Risk score',
          type: 'line',
          smooth: 0.35,
          symbol: 'circle',
          showSymbol: false,
          symbolSize: 6,
          data: ranked.map((a) => Number(a.score.toFixed(1))),
          z: 3,
          lineStyle: { width: 2.4, color: line, shadowBlur: 14, shadowColor: hexA(line, 0.35) },
          itemStyle: { color: line, borderColor: theme === 'dark' ? '#0e1522' : '#ffffff', borderWidth: 2 },
          areaStyle: {
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: hexA(line, 0.26) },
                { offset: 0.6, color: hexA(line, 0.07) },
                { offset: 1, color: hexA(line, 0) },
              ],
            },
          },
          emphasis: { focus: 'series', lineStyle: { width: 2.8 } },
          markLine: {
            silent: true,
            symbol: 'none',
            lineStyle: { color: hexA(t.muted, 0.55), type: 'dashed', width: 1 },
            label: {
              formatter: `KEV band ${(ML_BANDS.elevated * 100).toFixed(0)}`,
              position: 'insideMiddleTop',
              color: t.muted,
              fontSize: 8,
              fontFamily: chartFont,
            },
            data: [{ yAxis: ML_BANDS.elevated * 100 }],
          },
        },
      ],
    }
  }, [activeAlerts, theme])

  const focusQueue = () => {
    document.getElementById('alert-queue')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div className="page dashboard-page alerts-page exposure-page">
      <div className="xp-shell">
      <header className="mc-header">
        <div>
          <span className="mono mc-eyebrow">EARLY WARNING CENTRE · CORRELATED QUEUE</span>
          <h1>Every alert earns its place</h1>
          <p>
            Version-aware correlation first, deterministic scoring second, language last. Suppressed candidates
            stay visible and explain why they were hidden.
          </p>
        </div>
        <div className="mc-header-actions">
          <span className="mc-chip">
            <Sparkles size={12} /> {ackedActive} acknowledged
          </span>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() =>
              toast(admin ? 'CSV export is disabled in demo mode' : 'Export requires an admin account')
            }
            disabled={!admin}
            title={admin ? 'Export the alert queue' : 'Admin access required'}
          >
            {admin ? <Download size={13} /> : <Lock size={13} />} Export
          </button>
          <button className="btn btn-primary btn-sm" onClick={focusQueue}>
            Review queue <ArrowRight size={13} />
          </button>
        </div>
      </header>

      <div className="mc-shell">
        <div className="mc-col-left">
          <section className="mc-card mc-posture-card">
            <McHead icon={<ShieldAlert size={17} />} tone="orange" title="Queue load" sub="Correlated candidates · live" />
            <div className="mc-posture-body">
              <MoonGauge
                value={activeAlerts.length}
                label="active alerts"
                ariaLabel="Active alerts"
                segments={levelCounts.map((l, i) => ({ value: l.value, color: gaugeColors[i], label: l.level }))}
              />
              <div className="mc-gauge-legend">
                {levelCounts.map((l, i) => (
                  <span className="mc-legend-dot" key={l.level}>
                    <i style={{ background: gaugeColors[i] }} />
                    {l.value} {l.level.toLowerCase()}
                  </span>
                ))}
              </div>
              <div className="mc-deduct">
                {activeAlerts.length} of {alerts.length} scored · {suppressedAlerts.length} gated
              </div>
            </div>
            <div className="mc-trio">
              <div>
                <span className="ic">
                  <AlertTriangle size={12} />
                </span>
                <strong>{levelCounts[0].value}</strong>
                <span>Critical</span>
              </div>
              <div>
                <span className="ic">
                  <Sparkles size={12} />
                </span>
                <strong>{kevActive}</strong>
                <span>KEV-linked</span>
              </div>
              <div>
                <span className="ic">
                  <Check size={12} />
                </span>
                <strong>{ackedActive}</strong>
                <span>Acknowledged</span>
              </div>
            </div>
          </section>

          <section className="mc-card mc-signal-card">
            <McHead
              icon={<Gauge size={16} />}
              tone="navy"
              title="Signal mix"
              sub="Kept vs gated candidates"
              action={<span className="mc-chip">n={alerts.length}</span>}
            />
            <div className="mc-signal-list">
              {relevanceRows.map((r) => (
                <div className="mc-signal-row" key={r.label}>
                  <div className="mc-signal-top">
                    <span className="mc-sev">
                      <i style={{ background: r.color }} />
                      {r.label}
                    </span>
                    <span className="mc-signal-share">{r.share.toFixed(0)}%</span>
                    <b>{r.value}</b>
                  </div>
                  <span className="mc-signal-track" aria-hidden="true">
                    <i style={{ width: `${Math.max(2, r.share)}%`, background: r.color }} />
                  </span>
                </div>
              ))}
            </div>
            <div className="mc-signal-foot">
              <div>
                <b>{matchedCount}</b>
                <span>scored &amp; ranked</span>
              </div>
              <div>
                <b>{suppressedAlerts.length}</b>
                <span>gated · audit kept</span>
              </div>
            </div>
          </section>
        </div>

        <div className="mc-col-main">
          <section className="mc-card mc-hero-card">
            <McHead
              icon={<Activity size={17} />}
              tone="soft"
              title="Queue risk curve"
              sub="Six-factor score against exploitation probability"
              action={
                <span className="mc-chip">
                  {activeAlerts.length} ranked · {suppressedAlerts.length} gated
                </span>
              }
            />
            <div className="mc-hero-body">
              <div className="mc-hero-left">
                <div className="mc-big">
                  <span className="mc-big-num">
                    <Counter to={activeAlerts.length} />
                  </span>
                  <button className="mc-details" onClick={focusQueue}>
                    Details
                  </button>
                </div>
                <div className="mc-big-label">
                  Active alerts <span className="dim">· {suppressedAlerts.length} suppressed kept for audit</span>
                </div>
                <div className="mc-break">
                  {levelShares.map((s) => (
                    <div
                      className="mc-break-row"
                      key={s.level}
                      style={{ '--tone': LEVEL_COLORS[s.level] } as CSSProperties}
                    >
                      <div className="top">
                        <span>{s.level.charAt(0) + s.level.slice(1).toLowerCase()}</span>
                        <b>{s.share.toFixed(1)}%</b>
                      </div>
                      <div className="mc-break-track">
                        <i style={{ width: `${Math.max(2, s.share)}%` }} />
                      </div>
                      <div className="sub">{s.value} alerts in the queue</div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="mc-hero-chart">
                <Chart option={riskOption} height={286} />
              </div>
            </div>
            <div className="mc-hero-foot">
              <div>
                <span className="lab">Version-confirmed</span>
                <span className="val">
                  {matchedCount} of {activeAlerts.length} alerts
                </span>
              </div>
              <div>
                <span className="lab">KEV-linked</span>
                <span className="val">{kevActive} in the live queue</span>
              </div>
              <div>
                <span className="lab">Acknowledged</span>
                <span className="val">{ackedActive} by analysts</span>
              </div>
            </div>
          </section>

          <div className="mc-lower">
            <section className="mc-card mc-exposure-card">
              <McHead
                icon={<Globe2 size={16} />}
                tone="soft"
                title="Top exposure"
                sub="Departments carrying the active queue"
                action={<span className="mc-chip">n={activeAlerts.length}</span>}
              />
              <div className="mc-table" role="table" aria-label="Active alerts by department">
                <div className="mc-table-head" role="row">
                  <span role="columnheader">Department</span>
                  <span className="num" role="columnheader">
                    Share
                  </span>
                  <span className="num" role="columnheader">
                    Alerts
                  </span>
                </div>
                <div className="mc-table-body" role="rowgroup">
                  {deptRows.slice(0, 5).map((d) => (
                    <div className="mc-row" role="row" key={d.name}>
                      <span role="cell">
                        <span className="mc-sev">
                          <i style={{ background: d.color }} />
                          {d.name}
                        </span>
                      </span>
                      <span className="num pct" role="cell">
                        {d.share.toFixed(0)}%
                      </span>
                      <span className="num" role="cell">
                        {d.count}
                      </span>
                    </div>
                  ))}
                  {deptRows.length > 5 && (
                    <div className="mc-row" role="row">
                      <span role="cell">
                        <span className="mc-sev">
                          <i style={{ background: gaugeColors[3] }} />
                          Other
                        </span>
                      </span>
                      <span className="num pct" role="cell">
                        {deptRows
                          .slice(5)
                          .reduce((sum, d) => sum + d.share, 0)
                          .toFixed(0)}
                        %
                      </span>
                      <span className="num" role="cell">
                        {deptRows.slice(5).reduce((sum, d) => sum + d.count, 0)}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </section>

            <section className="mc-card mc-cohort-card">
              <McHead
                icon={<Layers size={16} />}
                tone="navy"
                title="Alert aging"
                sub="Open queue by age and severity"
                action={<span className="mc-chip">n={activeAlerts.length}</span>}
              />
              <div className="mc-cohort-body">
                <div className="mc-cohort-summary">
                  <div className="num">
                    <Counter to={medianAge} />
                    <small>h</small>
                  </div>
                  <div className="lab">median age</div>
                  <p>
                    oldest {oldestAge}h · {activeAlerts.length} open
                  </p>
                  <ul className="mc-cohort-legend">
                    {LEVELS.map((l, i) => (
                      <li key={l}>
                        <i style={{ background: gaugeColors[i] }} />
                        {l.charAt(0) + l.slice(1).toLowerCase()}
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="mc-cohort-grid" role="table" aria-label="Active alerts by age band and severity">
                  <span className="corner" aria-hidden="true" />
                  {LEVELS.map((level) => (
                    <span className="col-head" key={`col-${level}`} role="columnheader">
                      {level.slice(0, 4)}
                    </span>
                  ))}
                  {AGE_BANDS.flatMap((band, bi) => [
                    <span className="row-head" key={`h-${band.label}`}>
                      {band.label}
                    </span>,
                    ...LEVELS.map((level, li) => {
                      const v = cohortMatrix[bi][li]
                      return (
                        <span
                          key={`${band.label}-${level}`}
                          className={cx('mc-cohort-cell', v > 0 && 'filled')}
                          style={
                            {
                              '--i': bi * 4 + li,
                              ...(v > 0 ? { background: hexA(gaugeColors[li], 0.18 + Math.min(v, 3) * 0.24) } : {}),
                            } as CSSProperties
                          }
                          title={`${v} ${level.toLowerCase()} · ${band.label}`}
                          role="cell"
                        >
                          {v > 0 ? v : ''}
                        </span>
                      )
                    }),
                  ])}
                </div>
              </div>
            </section>
          </div>
        </div>
      </div>

      <div className="mc-stack alerts-stack">
        <Panel
          id="alert-queue"
          className="col-12 alerts-queue"
          title="Alert queue"
          sub={`${rows.length} of ${alerts.length} candidates after filters · suppression never deletes the record`}
          action={<span className="badge real">NVD · KEV · EPSS</span>}
          noPad
        >
        <div className="filters-bar">
          <div className="topbar-search" style={{ maxWidth: 300 }}>
            <Search size={13} />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter CVE, asset, department…"
              aria-label="Filter alerts"
            />
          </div>
          <div className="seg">
            {(['ALL', 'CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const).map((l) => (
              <button key={l} className={level === l ? 'on' : undefined} onClick={() => setLevel(l)}>
                {l === 'ALL' ? 'All levels' : l}
              </button>
            ))}
          </div>
          <select
            className="select"
            style={{ width: 190 }}
            value={relevance}
            onChange={(e) => setRelevance(e.target.value as RelevanceFilter)}
            aria-label="Relevance status"
          >
            <option value="ALL">All relevance states</option>
            <option value="MATCHED">Version in range</option>
            <option value="VERSION_UNKNOWN">Version unverified</option>
            <option value="NOT_AFFECTED">Not affected</option>
            <option value="PRODUCT_ABSENT">Product absent</option>
          </select>
          <div className="filters-spacer" />
          <button
            className="chip"
            onClick={() => setKevOnly((v) => !v)}
            aria-pressed={kevOnly}
            style={kevOnly ? { borderColor: 'var(--amber)', color: 'var(--amber)' } : undefined}
          >
            <ShieldAlert size={12} /> KEV only
          </button>
          <button
            className="chip"
            onClick={() => setShowSuppressed((v) => !v)}
            aria-pressed={showSuppressed}
            style={showSuppressed ? { borderColor: 'var(--line-strong)' } : { opacity: 0.55 }}
          >
            {showSuppressed ? <Check size={12} /> : <X size={12} />} Suppressed
          </button>
        </div>

        {rows.length === 0 ? (
          <EmptyState title="No alert matches this filter" hint="Clear the search or switch relevance state." />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th style={{ width: 58 }}>Score</th>
                  <th>Alert</th>
                  <th>Level</th>
                  <th>Relevance</th>
                  <th>EPSS</th>
                  <th>KEV</th>
                  <th className="right">Likely exploited</th>
                  <th>Confidence</th>
                  <th className="right">Raised</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((a, index) => {
                  const isAcked = Boolean(acks[a.id])
                  return (
                    <tr
                      key={a.id}
                      className={`clickable row-enter${a.suppressed ? ' suppressed-row' : ''}`}
                      style={{ '--i': Math.min(index, 12) } as CSSProperties}
                      onClick={() => open(a)}
                      aria-label={`Open ${a.cve.id} alert`}
                    >
                      <td>
                        <span className={`score-cell ${a.suppressed ? 'suppressed' : a.level.toLowerCase()}`}>
                          {fmtScore(a.score)}
                        </span>
                      </td>
                      <td>
                        <div className="cell-title">
                          {a.cve.id} <span className="dim">·</span> {a.asset.name}
                          {isAcked && (
                            <span className="badge low" style={{ marginLeft: 8 }}>
                              ack
                            </span>
                          )}
                        </div>
                        <div className="cell-sub">{a.cve.title}</div>
                      </td>
                      <td>
                        <SeverityBadge level={a.level} suppressed={a.suppressed} />
                      </td>
                      <td>
                        <RelevanceBadge relevance={a.relevance} />
                      </td>
                      <td className="mono">{a.cve.epss == null ? '—' : fmtPct(a.cve.epss)}</td>
                      <td>{a.cve.kev ? <span className="badge high">KEV</span> : <span className="dim mono">—</span>}</td>
                      <td>
                        <MlProb alert={a} />
                      </td>
                      <td>
                        <span className="mono" style={{ fontSize: 9 }}>
                          {a.confidence}
                        </span>
                      </td>
                      <td className="right mono">{timeAgo(a.createdAt, DEMO_NOW)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="table-note">
          <span className="inline-flex">
            <AlertTriangle size={11} /> Suppressed rows show the score they would have received, so nothing is
            hidden. “Likely exploited” is a model estimate; whether the installed version is affected still decides
            the final score.
          </span>
          <span className="mono">{rows.length} records · {DEMO_NOW.toISOString().slice(0, 10)}</span>
        </div>
        </Panel>

        <StatsPanel
          className="col-7"
          stats={[
            {
              name: 'Held back',
              value: `${((suppressedAlerts.length / alerts.length) * 100).toFixed(1)}%`,
              formula: 'held back ÷ all candidates',
              n: alerts.length,
              note: 'Original score kept for review.',
            },
            {
              name: 'Matched coverage',
              value: `${activeAlerts.filter((a) => a.relevance === 'MATCHED').length}/${activeAlerts.length}`,
              formula: 'version in range ÷ active',
              n: activeAlerts.length,
            },
            {
              name: 'Score range',
              value: `${fmtScore(Math.min(...activeAlerts.map((a) => a.score)))}–${fmtScore(
                Math.max(...activeAlerts.map((a) => a.score)),
              )}`,
              formula: 'lowest–highest active score',
              n: activeAlerts.length,
            },
            {
              name: 'KEV share',
              value: `${(
                (activeAlerts.filter((a) => a.cve.kev).length / activeAlerts.length) *
                100
              ).toFixed(0)}%`,
              formula: 'on CISA KEV ÷ active',
              n: activeAlerts.length,
            },
          ]}
        />
        <Panel
          className="col-5 mc-suppress-card"
          title="Why suppression exists"
          sub="A severity-only queue cannot tell these apart"
          bodyClass="mc-suppress-body"
        >
          <div className="mc-suppress-list">
            {suppressedAlerts.map((a) => (
              <button key={a.id} className="mc-suppress-row" onClick={() => open(a)}>
                <div className="mc-suppress-top">
                  <span className="mono">{a.cve.id}</span>
                  <span className="badge suppressed">would have scored {fmtScore(a.wouldHaveScored ?? 0)}</span>
                </div>
                <div className="mc-suppress-sub">
                  {a.asset.name} · {relevanceReason[a.relevance]}
                </div>
              </button>
            ))}
            <p className="mc-suppress-note">
              Each row keeps its original severity, exploit-likelihood, and known-exploited inputs. The version
              check sets the live score to zero but keeps the original score so you can review it.
            </p>
          </div>
        </Panel>
      </div>
      </div>

      <Drawer
        open={Boolean(selected)}
        onClose={close}
        label={selected ? `${selected.cve.id} alert` : 'Alert detail'}
        board
      >
        {selected && (
          <AlertDetail
            alert={selected}
            acks={acks}
            stage={selectedStage}
            actionCount={selectedActions.length}
            openActions={selectedOpenActions}
            onOpenActions={() => navigate(`/app/recommendations?cve=${selected.cve.id}`)}
            onClose={close}
            onAck={() => {
              ack(selected.id, session?.name ?? 'Analyst', 'Reviewed in demo session.')
              toast(`${selected.cve.id} acknowledged`)
            }}
          />
        )}
      </Drawer>
    </div>
  )
}

function MlProb({ alert }: { alert: Alert }) {
  const ml = predict(alert)
  const pct = Math.round(ml.probability * 100)
  if (alert.suppressed) {
    return (
      <div
        className="ml-prob gated"
        title={`Held back by the version check · model estimate ${(ml.probability * 100).toFixed(1)}%`}
      >
        <span className="ml-prob-gated mono">gated</span>
      </div>
    )
  }
  return (
    <div className={`ml-prob ${ml.band.toLowerCase()}`} title={`Model estimate ${(ml.probability * 100).toFixed(1)}% chance this is exploited`}>
      <span className="ml-prob-value mono">{pct}%</span>
      <span className="ml-prob-track" aria-hidden="true">
        <i style={{ width: `${Math.max(3, pct)}%` }} />
      </span>
    </div>
  )
}

const SCORE_FACTORS: {
  key: 'severity_points' | 'exploit_points' | 'kev_points' | 'criticality_points' | 'exposure_points' | 'relevance_points'
  label: string
  short: string
  hint: string
  max: number
  color: string
}[] = [
  {
    key: 'severity_points',
    label: 'Damage if exploited',
    short: 'Severity',
    hint: 'How much damage a successful attack could cause.',
    max: 25,
    color: 'var(--bd-crit)',
  },
  {
    key: 'exploit_points',
    label: 'Chance of exploitation',
    short: 'Exploit chance',
    hint: 'Estimated likelihood of exploitation over the next 30 days.',
    max: 25,
    color: 'var(--bd-orange)',
  },
  {
    key: 'kev_points',
    label: 'Already exploited in the wild',
    short: 'Known exploited',
    hint: 'Confirmed in CISA’s known exploited vulnerabilities catalog.',
    max: 10,
    color: 'var(--bd-warn)',
  },
  {
    key: 'criticality_points',
    label: 'Importance of the system',
    short: 'System importance',
    hint: 'How critical this asset is to the business.',
    max: 25,
    color: 'var(--bd-navy)',
  },
  {
    key: 'exposure_points',
    label: 'Reachable from the internet',
    short: 'Internet reach',
    hint: 'Internet-facing systems are easier to attack.',
    max: 5,
    color: 'var(--bd-slate)',
  },
  {
    key: 'relevance_points',
    label: 'Version is affected',
    short: 'Version affected',
    hint: 'The installed version falls inside the vulnerable range.',
    max: 10,
    color: 'var(--bd-green)',
  },
]

const plainRange = (cve: Alert['cve']) => {
  const { range } = cve
  const low = range.startIncluding
    ? `from ${range.startIncluding}`
    : range.startExcluding
      ? `after ${range.startExcluding}`
      : null
  const high = range.endIncluding
    ? `up to ${range.endIncluding}`
    : range.endExcluding
      ? `up to but not including ${range.endExcluding}`
      : null
  if (!low && !high) return 'No published range'
  return [low, high].filter(Boolean).join(' ')
}

const VERDICT: Record<RelevanceStatus, { title: string; body: string; tone: 'watch' | 'ok' }> = {
  MATCHED: {
    title: 'Yes — this system is exposed',
    body: 'The installed version sits inside the vulnerable range, so this alert counts toward risk.',
    tone: 'watch',
  },
  VERSION_UNKNOWN: {
    title: 'Possibly — the version needs checking',
    body: 'The software is installed but its version is not recorded. Confirm the version to finish the assessment.',
    tone: 'watch',
  },
  NOT_AFFECTED: {
    title: 'No — this version is not affected',
    body: 'The installed version sits outside the vulnerable range, so the alert is held back.',
    tone: 'ok',
  },
  PRODUCT_ABSENT: {
    title: 'No — the affected software is not installed',
    body: 'This system does not run the affected product, so the alert is held back.',
    tone: 'ok',
  },
}

function AlertDetail({
  alert,
  acks,
  stage,
  actionCount,
  openActions,
  onOpenActions,
  onAck,
  onClose,
}: {
  alert: Alert
  acks: Record<string, { by: string; at: string; note?: string }>
  stage: WarningStage
  actionCount: number
  openActions: number
  onOpenActions: () => void
  onAck: () => void
  onClose: () => void
}) {
  const cvss = alert.cve.cvss
  const epss = alert.cve.epss
  const shownScore = alert.suppressed ? (alert.wouldHaveScored ?? 0) : alert.score
  const verdict = VERDICT[alert.relevance]
  const VerdictIcon = alert.relevance === 'MATCHED' ? ShieldAlert : alert.relevance === 'VERSION_UNKNOWN' ? AlertTriangle : ShieldCheck
  const ack = acks[alert.id]
  const stageIndex = WARNING_STAGES.findIndex((s) => s.key === stage)
  const heroLine =
    alert.relevance === 'MATCHED'
      ? `${alert.asset.name} runs ${alert.cve.product} ${alert.version}, which falls inside the affected range.`
      : alert.relevance === 'VERSION_UNKNOWN'
        ? `${alert.asset.name} runs ${alert.cve.product}, but the installed version is not recorded.`
        : alert.relevance === 'PRODUCT_ABSENT'
          ? `${alert.cve.product} is not installed on ${alert.asset.name}.`
          : `${alert.asset.name} runs ${alert.cve.product} ${alert.version}, which sits outside the affected range.`
  const segments = SCORE_FACTORS.map((factor) => ({
    label: factor.short,
    value: alert.breakdown[factor.key],
    color: factor.color,
  }))

  return (
    <>
      <DrawerHead
        overline={`${alert.asset.name} · ${alert.asset.department}`}
        title={
          <span className="inline-flex" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            {alert.cve.id} <SeverityBadge level={alert.level} suppressed={alert.suppressed} />
          </span>
        }
        onClose={onClose}
        meta={
          <span className="inline-flex" style={{ flexWrap: 'wrap', gap: 6 }}>
            {alert.cve.kev && <span className="badge critical">Known exploited</span>}
            {alert.asset.internetFacing && <span className="badge medium">Internet-facing</span>}
            <ConfidenceBadge confidence={alert.confidence} />
            <span className="badge simulated">Demo inventory</span>
          </span>
        }
      />
      <div className="drawer-body">
        <div className="drawer-section">
          <div className="bd-hero">
            <BoardDial
              value={shownScore}
              max={100}
              color={alert.suppressed ? 'var(--bd-muted)' : levelColor[alert.level]}
              display={fmtScore(shownScore)}
              label={alert.suppressed ? 'would have scored' : `${levelLabel[alert.level]} risk`}
              sub="out of 100"
              ghost={alert.suppressed}
              size={158}
            />
            <div className="bd-hero-copy">
              <span className="bd-kicker">{alert.suppressed ? 'Held back — not counted' : 'Active risk'}</span>
              <h3>{alert.cve.title}</h3>
              <p>{heroLine}</p>
              <div className="bd-chips">
                <span className="bd-chip">{alert.asset.name}</span>
                <span className="bd-chip">{alert.version === 'unknown' ? 'Version not recorded' : `Installed ${alert.version}`}</span>
                <span className="bd-chip">{timeAgo(alert.createdAt, DEMO_NOW)}</span>
              </div>
            </div>
          </div>
        </div>

        <div className="drawer-section">
          <h3>Early warning stage</h3>
          <div className="bd-stage-strip" style={{ '--stage': stageIndex } as CSSProperties}>
            <span className="bd-stage-line" aria-hidden="true" />
            {WARNING_STAGES.map((s, i) => (
              <div
                key={s.key}
                className={cx('bd-stage', i < stageIndex && 'is-done', i === stageIndex && 'is-current')}
                title={s.description}
              >
                <span className="bd-stage-dot">{i < stageIndex ? <Check size={9} /> : null}</span>
                <span className="bd-stage-label">{s.short}</span>
              </div>
            ))}
          </div>
          <p className="bd-stage-copy">{stageMeta(stage).description}</p>
          <div className="bd-action">
            <span className="bd-kicker">
              Preventive actions
              {actionCount > 0 && ` · ${actionCount} generated`}
            </span>
            <strong>
              {openActions > 0
                ? `${openActions} still open`
                : actionCount > 0
                  ? 'All actions verified'
                  : stage === 'EMERGING'
                    ? 'Verify before acting'
                    : 'No action raised yet'}
            </strong>
            <p>
              {actionCount === 0
                ? 'This warning has no preventive action attached yet. Open the Recommendations Centre to see what the evidence requires.'
                : openActions > 0
                  ? 'The Recommendations Centre records who owns the fix, what “done” means, and whether fresh evidence proves it worked.'
                  : 'Every action attached to this warning has been verified against fresh evidence.'}
            </p>
            <button className="bd-btn" onClick={onOpenActions}>
              Open preventive actions <ArrowRight size={12} />
            </button>
          </div>
        </div>

        <div className="drawer-section">
          <h3>Why it scores this way</h3>
          <BoardComposition segments={segments} caption="How the risk score is built" />
          <BoardFactors
            rows={SCORE_FACTORS.map((factor) => ({
              label: factor.label,
              hint: factor.hint,
              value: alert.breakdown[factor.key],
              max: factor.max,
              color: factor.color,
            }))}
          />
          {alert.suppressed && (
            <p style={{ marginTop: 12, fontSize: 11, color: 'var(--bd-muted)' }}>
              These points are kept for review. The alert is not counted because this system is not affected.
            </p>
          )}
        </div>

        <div className="drawer-section">
          <h3>Exploitation signals</h3>
          <div className="bd-signals">
            <BoardMeter
              index={0}
              label="Damage if exploited (CVSS)"
              value={cvss ?? 0}
              max={10}
              display={cvss == null ? 'Not rated' : `${cvss.toFixed(1)} / 10`}
              hint="Severity rating published by NVD."
              color={cvss == null ? 'var(--bd-muted)' : 'var(--bd-crit)'}
            />
            <BoardMeter
              index={1}
              label="Chance of exploitation (EPSS)"
              value={(epss ?? 0) * 100}
              max={100}
              display={epss == null ? 'Not rated' : fmtPct(epss)}
              hint="Estimated probability of exploitation in the next 30 days."
              color="var(--bd-orange)"
            />
            <BoardMeter
              index={2}
              label="Known exploited (CISA KEV)"
              value={alert.cve.kev ? 100 : 0}
              max={100}
              display={alert.cve.kev ? 'Listed' : 'Not listed'}
              hint={alert.cve.kev ? 'CISA has confirmed exploitation in real attacks.' : 'No confirmed exploitation recorded.'}
              color={alert.cve.kev ? 'var(--bd-orange)' : 'var(--bd-slate)'}
            />
          </div>
        </div>

        <div className="drawer-section">
          <h3>Does this affect you?</h3>
          <div className={verdict.tone === 'ok' ? 'bd-verdict is-ok' : 'bd-verdict'}>
            <span className="bd-verdict-icon">
              <VerdictIcon size={16} />
            </span>
            <div>
              <strong>{verdict.title}</strong>
              <p>{verdict.body}</p>
              <div className="bd-compare">
                <span>
                  Installed
                  <b>{alert.version === 'unknown' ? 'Not recorded' : alert.version}</b>
                </span>
                <span className="bd-compare-vs">vs</span>
                <span>
                  Affected versions
                  <b>{plainRange(alert.cve)}</b>
                </span>
              </div>
            </div>
          </div>
          {alert.suppressed && (
            <div style={{ marginTop: 14 }}>
              <BoardMeter
                label="Score if it had counted"
                value={alert.wouldHaveScored ?? 0}
                max={100}
                display={fmtScore(alert.wouldHaveScored ?? 0)}
                hint="Kept for review only. The alert stays out of the active queue."
                color="var(--bd-slate)"
              />
            </div>
          )}
        </div>

        <div className="drawer-section">
          <h3>What to do</h3>
          <div className="bd-action">
            <span className="bd-kicker">{alert.cve.kev ? 'Known exploited — act now' : 'Recommended next step'}</span>
            <strong>{alert.action}</strong>
            {alert.cve.kevDue && <span className="bd-due">CISA remediation deadline · {fmtDate(alert.cve.kevDue)}</span>}
            <p>{alert.impact}</p>
          </div>
        </div>

        <div className="drawer-section">
          <h3>Review</h3>
          {ack ? (
            <div className="bd-ack">
              <div className="inline-flex" style={{ gap: 8, alignItems: 'center' }}>
                <Check size={14} className="check" />
                <strong>Acknowledged by {ack.by}</strong>
              </div>
              <p>
                {new Date(ack.at).toLocaleString('en-US')}
                {ack.note ? ` · ${ack.note}` : ''}
              </p>
            </div>
          ) : (
            <div className="bd-ack">
              <p>Record that a person has reviewed this alert. Acknowledging does not change the risk score.</p>
              <button className="bd-btn" onClick={onAck}>
                <Check size={13} /> Acknowledge alert
              </button>
            </div>
          )}
        </div>
      </div>
      <div className="drawer-foot">
        <span>Raised {timeAgo(alert.createdAt, DEMO_NOW)}</span>
        <span>NVD · FIRST EPSS · CISA KEV</span>
      </div>
    </>
  )
}
