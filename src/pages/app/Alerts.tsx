import { useMemo, useState, type CSSProperties } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Drawer, DrawerHead } from '../../components/Drawer'
import { Panel } from '../../components/Panel'
import { Chart, axisStyle, chartFont, chartTokens } from '../../components/Chart'
import { Counter } from '../../components/Counter'
import { McHead, MoonGauge } from '../../components/MoonCards'
import { Waterfall } from '../../components/Waterfall'
import { StatsPanel } from '../../components/StatsPanel'
import { SeverityBadge, ConfidenceBadge, RelevanceBadge, SourceBadge, UploadBadge } from '../../components/Badges'
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
  Sparkles,
  X,
} from '../../components/Icons'
import { DEMO_NOW } from '../../data/seed'
import { useAcks, useAuth, useFilters, useTheme, useToast } from '../../lib/store'
import { cx, fmtDate, fmtPct, fmtScore, timeAgo } from '../../lib/format'
import { median } from '../../lib/stats'
import { relevanceLabel, relevanceReason } from '../../lib/scoring'
import { predict, topFeatureImportance, featureValueLabel, FEATURE_LABELS, ML_BANDS, MODEL_CARD } from '../../lib/ml'
import { useLiveActiveAlerts, useLiveAlerts, useLiveSuppressedAlerts } from '../../lib/liveData'
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

  const selectedId = params.get('alert')
  const selected = selectedId ? alerts.find((a) => a.id === selectedId) ?? null : null

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
          <span className="mono mc-eyebrow">ALERT CENTER · CORRELATED QUEUE</span>
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
                  <th className="right">XGB p</th>
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
            <AlertTriangle size={11} /> Suppressed rows display the score they would have received — the gate is
            explained, not hidden. XGB p is the model's KEV-membership prior; relevance still overrides it.
          </span>
          <span className="mono">{rows.length} records · {DEMO_NOW.toISOString().slice(0, 10)}</span>
        </div>
        </Panel>

        <StatsPanel
          className="col-7"
          stats={[
            {
              name: 'Suppression precision',
              value: `${((suppressedAlerts.length / alerts.length) * 100).toFixed(1)}%`,
              formula: 'suppressed ÷ correlation candidates',
              n: alerts.length,
              note: 'Would-have-scored retained for audit.',
            },
            {
              name: 'Matched coverage',
              value: `${activeAlerts.filter((a) => a.relevance === 'MATCHED').length}/${activeAlerts.length}`,
              formula: 'version-confirmed ÷ active alerts',
              n: activeAlerts.length,
            },
            {
              name: 'Score range',
              value: `${fmtScore(Math.min(...activeAlerts.map((a) => a.score)))}–${fmtScore(
                Math.max(...activeAlerts.map((a) => a.score)),
              )}`,
              formula: 'min–max over active alerts',
              n: activeAlerts.length,
            },
            {
              name: 'KEV share',
              value: `${(
                (activeAlerts.filter((a) => a.cve.kev).length / activeAlerts.length) *
                100
              ).toFixed(0)}%`,
              formula: 'KEV-listed ÷ active alerts',
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
              Each row keeps its original CVSS, EPSS, and KEV inputs. The relevance gate sets the score to zero
              but stores <span className="mono">suppressed_would_have_scored</span> for review.
            </p>
          </div>
        </Panel>
      </div>
      </div>

      <Drawer open={Boolean(selected)} onClose={close} label={selected ? `${selected.cve.id} alert` : 'Alert detail'}>
        {selected && (
          <AlertDetail
            alert={selected}
            acks={acks}
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
        title={`Version-relevance gate applied · audit prior ${(ml.probability * 100).toFixed(1)}%`}
      >
        <span className="ml-prob-gated mono">gated</span>
      </div>
    )
  }
  return (
    <div className={`ml-prob ${ml.band.toLowerCase()}`} title={`XGBoost ${(ml.probability * 100).toFixed(1)}% · ${ml.band.toLowerCase()} band`}>
      <span className="ml-prob-value mono">{pct}%</span>
      <span className="ml-prob-track" aria-hidden="true">
        <i style={{ width: `${Math.max(3, pct)}%` }} />
      </span>
    </div>
  )
}

function MlDetail({ alert }: { alert: Alert }) {
  const ml = predict(alert)
  const pct = (ml.probability * 100).toFixed(1)
  return (
    <div className="ml-detail">
      <div className="ml-detail-head">
        <div className="ml-detail-score">
          <strong>{pct}%</strong>
          <span className={`ml-band ${ml.band.toLowerCase()}`}>{ml.band}</span>
        </div>
        <span className="mono">KEV-membership prior · {MODEL_CARD.version}</span>
      </div>
      <div className="ml-detail-track" aria-hidden="true">
        <i style={{ width: `${ml.probability * 100}%` }} />
        <span
          className="ml-threshold"
          style={{ left: `${ML_BANDS.elevated * 100}%` }}
          title={`ELEVATED band starts at ${(ML_BANDS.elevated * 100).toFixed(1)}%`}
        />
      </div>
      <div className="ml-inputs">
        {topFeatureImportance.map((f) => (
          <div className="ml-input" key={f.feature}>
            <span>{FEATURE_LABELS[f.feature] ?? f.feature}</span>
            <strong>{featureValueLabel(f.feature, ml.features[f.feature] ?? 0)}</strong>
            <small className="mono">{f.share.toFixed(0)}% gain</small>
          </div>
        ))}
      </div>
      <p className="dim ml-detail-note">
        A real gradient-boosted model ({MODEL_CARD.rounds} trees, test AUC {MODEL_CARD.test.auc.toFixed(3)},
        fitted on {MODEL_CARD.dataset.rows.toLocaleString('en-US')} live NVD/EPSS records) scores KEV-membership
        likelihood as a second opinion. The six-factor deterministic score remains authoritative.
      </p>
      {alert.suppressed && (
        <p className="ml-detail-gate">
          The relevance gate overrides the model here: the product or version is not affected, so the alert stays
          suppressed even though a prior is retained for audit.
        </p>
      )}
    </div>
  )
}

function AlertDetail({
  alert,
  acks,
  onAck,
  onClose,
}: {
  alert: Alert
  acks: Record<string, { by: string; at: string; note?: string }>
  onAck: () => void
  onClose: () => void
}) {
  const installed = alert.version
  const provenance = [
    {
      label: 'NVD record',
      ok: true,
      value: `last modified ${fmtDate(alert.cve.modified)}`,
    },
    {
      label: 'CPE affected range',
      ok: alert.relevance !== 'PRODUCT_ABSENT',
      value:
        alert.cve.range.startIncluding || alert.cve.range.endExcluding
          ? `${alert.cve.range.startIncluding ?? '*'} → ${alert.cve.range.endExcluding ? `< ${alert.cve.range.endExcluding}` : alert.cve.range.endIncluding ? `≤ ${alert.cve.range.endIncluding}` : '*'}`
          : 'range not published',
    },
    {
      label: 'FIRST EPSS',
      ok: alert.cve.epss != null,
      value: alert.cve.epss == null ? 'score missing' : `${fmtPct(alert.cve.epss)} · ${alert.cve.epssPercentile}th pct`,
    },
    {
      label: 'CISA KEV membership',
      ok: alert.cve.kev,
      value: alert.cve.kev ? `due ${alert.cve.kevDue ? fmtDate(alert.cve.kevDue) : 'n/a'}` : 'not listed',
    },
    {
      label: 'Asset inventory',
      ok: true,
      value: `${alert.asset.name} · ${alert.asset.department}`,
    },
    {
      label: 'Installed version',
      ok: alert.relevance === 'MATCHED',
      value: installed === 'unknown' ? 'version unverified' : installed,
    },
  ]

  return (
    <>
      <DrawerHead
        overline={`${alert.id} · ${alert.relevance === 'MATCHED' ? 'VERSION-CONFIRMED' : relevanceLabel[alert.relevance].toUpperCase()}`}
        title={
          <span className="inline-flex" style={{ gap: 10, flexWrap: 'wrap' }}>
            {alert.cve.id} <SeverityBadge level={alert.level} suppressed={alert.suppressed} />
          </span>
        }
        onClose={onClose}
        meta={
          <span className="inline-flex" style={{ flexWrap: 'wrap', gap: 8 }}>
            <SourceBadge source="NVD" />
            {alert.cve.kev && <SourceBadge source="CISA KEV" />}
            <span className="badge simulated">Asset inventory · simulated</span>
            <ConfidenceBadge confidence={alert.confidence} />
          </span>
        }
      />
      <div className="drawer-body">
        <div className="drawer-section">
          <p style={{ fontSize: 13.5, color: 'var(--text)', lineHeight: 1.65 }}>{alert.summary}</p>
          <div className="drawer-meta">
            <span>{alert.asset.name}</span>
            <span>{installed === 'unknown' ? 'version unverified' : `installed ${installed}`}</span>
            <span>{timeAgo(alert.createdAt, DEMO_NOW)}</span>
          </div>
        </div>

        <div className="drawer-section">
          <h3>Score derivation</h3>
          <Waterfall alert={alert} />
        </div>

        <div className="drawer-section">
          <h3>Exploitation model · XGBoost</h3>
          <MlDetail alert={alert} />
        </div>

        <div className="drawer-section">
          <h3>Relevance gate</h3>
          <div className="action-box" style={{ borderColor: alert.suppressed ? 'var(--line)' : 'rgba(62,210,193,.28)' }}>
            <div className="inline-flex" style={{ justifyContent: 'space-between', width: '100%' }}>
              <strong style={{ fontSize: 12 }}>{relevanceLabel[alert.relevance]}</strong>
              <span className="mono">{alert.suppressed ? 'score zeroed' : 'score retained'}</span>
            </div>
            <p style={{ marginTop: 6, fontSize: 12, color: 'var(--text-dim)' }}>{relevanceReason[alert.relevance]}</p>
            {alert.suppressed && (
              <p style={{ marginTop: 6, fontSize: 11, color: 'var(--medium)' }} className="mono">
                suppressed_would_have_scored = {fmtScore(alert.wouldHaveScored ?? 0)}
              </p>
            )}
          </div>
        </div>

        <div className="drawer-section">
          <h3>Impact</h3>
          <p>{alert.impact}</p>
        </div>

        <div className="drawer-section">
          <h3>Recommended action</h3>
          <div className="action-box">
            <strong style={{ fontSize: 12 }}>{alert.action}</strong>
            {alert.cve.kevDue && (
              <p className="mono" style={{ marginTop: 6, color: 'var(--amber)' }}>
                CISA remediation due {fmtDate(alert.cve.kevDue)}
              </p>
            )}
          </div>
        </div>

        <div className="drawer-section">
          <h3>Provenance</h3>
          <div className="provenance-list">
            {provenance.map((p) => (
              <div className="provenance-row" key={p.label}>
                {p.ok ? <Check size={12} className="check" /> : <AlertTriangle size={12} className="miss" />}
                <span>{p.label}</span>
                <span className="time">{p.value}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="drawer-section">
          <h3>Extracted entities</h3>
          <div className="entity-tags">
            {[alert.cve.product, installed !== 'unknown' ? installed : 'version-unverified', ...alert.cve.cwe]
              .filter(Boolean)
              .map((e) => (
                <span className="entity-tag" key={e}>
                  {e}
                </span>
              ))}
            <span className="entity-tag">{alert.cve.vendor}</span>
          </div>
        </div>

        <div className="drawer-section">
          <h3>Sources</h3>
          <div className="inline-flex" style={{ flexWrap: 'wrap', gap: 6 }}>
            <SourceBadge source="NVD" />
            <SourceBadge source="FIRST EPSS" />
            {alert.cve.kev && <SourceBadge source="CISA KEV" />}
            <SourceBadge source="SIMULATED" />
            <UploadBadge />
          </div>
          <p className="dim mt-8" style={{ fontSize: 11 }}>
            Asset inventory in this demo is labelled SIMULATED. In a deployment it is replaced by the
            customer&apos;s USER UPLOAD and carries filename, upload time, and uploader.
          </p>
        </div>

        <div className="drawer-section">
          <h3>Acknowledgement</h3>
          {acks[alert.id] ? (
            <div className="action-box">
              <div className="inline-flex">
                <Check size={13} className="check" />
                <strong style={{ fontSize: 12 }}>Acknowledged by {acks[alert.id].by}</strong>
              </div>
              <p className="mono" style={{ marginTop: 6 }}>
                {new Date(acks[alert.id].at).toLocaleString('en-US')}
                {acks[alert.id].note ? ` · ${acks[alert.id].note}` : ''}
              </p>
            </div>
          ) : (
            <div className="action-box">
              <p style={{ fontSize: 12, color: 'var(--text-dim)' }}>
                Acknowledging records who reviewed the alert and when. It does not change the score.
              </p>
              <button className="btn btn-primary btn-sm mt-12" onClick={onAck}>
                <Check size={13} /> Acknowledge alert
              </button>
            </div>
          )}
        </div>
      </div>
      <div className="drawer-foot">
        <span className="mono">alert {alert.id}</span>
        <span className="mono">formula v{alert.breakdown.formula_version}</span>
      </div>
    </>
  )
}
