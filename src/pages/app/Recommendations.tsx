import { useMemo, useState, type CSSProperties } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import './recommendations.css'
import { Chart, axisStyle, chartFont, chartTokens } from '../../components/Chart'
import { Drawer, DrawerHead } from '../../components/Drawer'
import { McHead, MoonGauge } from '../../components/MoonCards'
import { Panel } from '../../components/Panel'
import { Counter } from '../../components/Counter'
import { SeverityBadge } from '../../components/Badges'
import { EmptyState } from '../../components/EmptyState'
import { BoardStat, levelColor, levelLabel } from '../../components/BoardDetail'
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Check,
  ExternalLink,
  Info,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  User,
  X,
  Zap,
} from '../../components/Icons'
import { DEMO_NOW } from '../../data/seed'
import { useLiveAlerts } from '../../lib/liveData'
import { useActions, entryStatus } from '../../lib/actionStore'
import { useAuth, useTheme, useToast } from '../../lib/store'
import { cx, fmtDate, fmtDateShort, fmtScore, timeAgo } from '../../lib/format'
import {
  ACTION_STATUS_LABEL,
  ACTION_STEPS,
  KIND_LABEL,
  PRIORITY_LABEL,
  PRIORITY_ORDER,
  actionStats,
  buildRecommendations,
  isOverdue,
  isStale,
  stageMeta,
  warningStageFor,
  type ActionStatus,
  type Recommendation,
  type RecommendationKind,
  type RecommendationPriority,
} from '../../lib/warnings'
import type { Alert } from '../../lib/types'

const STATUS_ORDER: ActionStatus[] = ['NEW', 'ACCEPTED', 'IN_PROGRESS', 'COMPLETED', 'VERIFIED']

const STATUS_COLORS: Record<ActionStatus, string> = {
  NEW: '#8d99a8',
  ACCEPTED: '#3ed2c1',
  IN_PROGRESS: '#e3a455',
  COMPLETED: '#14263e',
  VERIFIED: '#3fae74',
}

const KIND_TONE: Record<RecommendationKind, string> = {
  PATCH: 'patch',
  VERIFY: 'verify',
  EXPOSURE: 'exposure',
}

type StatusFilter = 'ALL' | 'OPEN' | ActionStatus

export default function Recommendations() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const theme = useTheme((s) => s.theme)
  const session = useAuth((s) => s.session)
  const toast = useToast((s) => s.show)

  const alerts = useLiveAlerts()
  const recs = useMemo(() => buildRecommendations(alerts), [alerts])
  const entries = useActions((s) => s.entries)
  const stats = useMemo(() => actionStats(recs, entries), [recs, entries])

  const [priority, setPriority] = useState<'ALL' | RecommendationPriority>('ALL')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('OPEN')
  const [team, setTeam] = useState('ALL')
  const [text, setText] = useState('')

  const focusCve = params.get('cve')
  const selectedId = params.get('action')
  const selected = selectedId ? (recs.find((r) => r.id === selectedId) ?? null) : null

  const openRec = (rec: Recommendation) => {
    const next = new URLSearchParams(params)
    next.set('action', rec.id)
    setParams(next, { replace: true })
  }
  const closeRec = () => {
    const next = new URLSearchParams(params)
    next.delete('action')
    setParams(next, { replace: true })
  }
  const clearCve = () => {
    const next = new URLSearchParams(params)
    next.delete('cve')
    setParams(next, { replace: true })
  }

  const statusOf = (id: string) => entryStatus(entries, id)

  const teams = useMemo(() => [...new Set(recs.map((r) => r.team))].sort(), [recs])

  const rows = useMemo(() => {
    const q = text.trim().toLowerCase()
    return recs
      .filter((r) => (priority === 'ALL' ? true : r.priority === priority))
      .filter((r) => (team === 'ALL' ? true : r.team === team))
      .filter((r) => (focusCve ? r.cveId === focusCve : true))
      .filter((r) => {
        const status = statusOf(r.id)
        if (statusFilter === 'ALL') return true
        if (statusFilter === 'OPEN') return status !== 'VERIFIED'
        return status === statusFilter
      })
      .filter((r) =>
        q
          ? `${r.id} ${r.title} ${r.cveId} ${r.assetName} ${r.department} ${r.team}`.toLowerCase().includes(q)
          : true,
      )
  }, [recs, priority, team, focusCve, statusFilter, text, entries])

  const prioritySegments = PRIORITY_ORDER.map((p) => ({
    value: recs.filter((r) => r.priority === p && statusOf(r.id) !== 'VERIFIED').length,
    color: priorityColor(p, theme),
    label: p,
  }))

  const priorityOpen = PRIORITY_ORDER.map((p) => ({
    priority: p,
    open: recs.filter((r) => r.priority === p && statusOf(r.id) !== 'VERIFIED').length,
  }))

  const teamRows = useMemo(() => {
    const map = new Map<string, { open: number; p1: number; verified: number }>()
    recs.forEach((r) => {
      const status = statusOf(r.id)
      const row = map.get(r.team) ?? { open: 0, p1: 0, verified: 0 }
      if (status === 'VERIFIED') row.verified += 1
      else {
        row.open += 1
        if (r.priority === 'P1') row.p1 += 1
      }
      map.set(r.team, row)
    })
    return [...map.entries()]
      .map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.p1 - a.p1 || b.open - a.open)
  }, [recs, entries])

  const attention = useMemo(
    () =>
      recs
        .filter((r) => statusOf(r.id) !== 'VERIFIED')
        .filter((r) => r.priority === 'P1' || isOverdue(r, statusOf(r.id)))
        .sort(
          (a, b) =>
            PRIORITY_ORDER.indexOf(a.priority) - PRIORITY_ORDER.indexOf(b.priority) ||
            new Date(a.due).getTime() - new Date(b.due).getTime(),
        )
        .slice(0, 5),
    [recs, entries],
  )

  const verifiedAlertIds = useMemo(
    () =>
      new Set(
        recs.filter((r) => statusOf(r.id) === 'VERIFIED').map((r) => r.alertId),
      ),
    [recs, entries],
  )
  const clearedRisk = alerts
    .filter((a) => verifiedAlertIds.has(a.id) && !a.suppressed)
    .reduce((sum, a) => sum + a.score, 0)

  const chartOption = useMemo(() => {
    const ax = axisStyle(theme, { split: true })
    const t = chartTokens(theme)
    const ghost = theme === 'dark' ? 'rgba(150,168,192,0.14)' : 'rgba(20,38,62,0.06)'
    return {
      grid: { left: 34, right: 14, top: 20, bottom: 26 },
      legend: { show: false },
      xAxis: {
        type: 'category',
        data: PRIORITY_ORDER,
        ...ax,
        axisLabel: { ...ax.axisLabel, fontSize: 10, fontWeight: 600 },
        axisTick: { show: false },
      },
      yAxis: {
        type: 'value',
        minInterval: 1,
        ...ax,
        splitNumber: 4,
        axisLabel: { ...ax.axisLabel, fontSize: 9 },
      },
      tooltip: {
        trigger: 'axis',
        backgroundColor: theme === 'dark' ? 'rgba(12,18,30,0.97)' : '#14263e',
        borderWidth: 0,
        padding: [10, 12],
        textStyle: { color: '#ffffff', fontSize: 10.5, fontFamily: chartFont, lineHeight: 18 },
        extraCssText: 'border-radius:12px;box-shadow:0 20px 40px -18px rgba(16,24,40,.45);',
        axisPointer: { type: 'shadow', shadowStyle: { color: ghost } },
      },
      series: STATUS_ORDER.map((status) => ({
        name: ACTION_STATUS_LABEL[status],
        type: 'bar',
        stack: 'actions',
        barWidth: '46%',
        data: PRIORITY_ORDER.map(
          (p) => recs.filter((r) => r.priority === p && statusOf(r.id) === status).length,
        ),
        itemStyle: {
          color: statusColor(status, theme),
          borderRadius: status === 'VERIFIED' ? [5, 5, 0, 0] : 0,
        },
        emphasis: { focus: 'series' },
      })),
      textStyle: { fontFamily: chartFont, color: t.text },
    }
  }, [recs, entries, theme])

  const displayName = session?.name ?? 'Analyst'
  const status = selected ? statusOf(selected.id) : 'NEW'

  return (
    <div className="page dashboard-page exposure-page rec-page">
      <div className="xp-shell">
        <header className="mc-header">
          <div>
            <span className="mono mc-eyebrow">EARLY WARNING CENTRE · PREVENTIVE ACTIONS</span>
            <h1>Act before the warning becomes an incident</h1>
            <p>
              Every action is generated from live evidence — the CVE, the installed version, exploitation
              signals and how much the system matters. Marking work complete is not the same as proving it
              worked: only a person checking fresh evidence can close a warning.
            </p>
          </div>
          <div className="mc-header-actions">
            {focusCve && (
              <button className="mc-chip rec-chip-clear" onClick={clearCve}>
                {focusCve} <X size={11} />
              </button>
            )}
            <span className="mc-chip">
              <Sparkles size={12} /> {stats.p1Open} P1 open
            </span>
            <button
              className="btn btn-primary btn-sm"
              onClick={() => document.getElementById('action-queue')?.scrollIntoView({ behavior: 'smooth' })}
            >
              Review actions <ArrowRight size={13} />
            </button>
          </div>
        </header>

        <div className="mc-shell">
          <div className="mc-col-left">
            <section className="mc-card mc-posture-card">
              <McHead
                icon={<ShieldCheck size={17} />}
                tone="orange"
                title="Action load"
                sub="Open preventive work · live evidence"
              />
              <div className="mc-posture-body">
                <MoonGauge
                  value={stats.open}
                  label="open actions"
                  ariaLabel="Open preventive actions"
                  segments={prioritySegments}
                />
                <div className="mc-gauge-legend">
                  {prioritySegments.map((s) => (
                    <span className="mc-legend-dot" key={s.label}>
                      <i style={{ background: s.color }} />
                      {s.value} {s.label}
                    </span>
                  ))}
                </div>
                <div className="mc-deduct">
                  {stats.total} generated · {stats.verified} verified
                </div>
              </div>
              <div className="mc-trio">
                <div>
                  <span className="ic">
                    <Zap size={12} />
                  </span>
                  <strong>{stats.p1Open}</strong>
                  <span>P1 open</span>
                </div>
                <div>
                  <span className="ic">
                    <AlertTriangle size={12} />
                  </span>
                  <strong>{stats.overdue}</strong>
                  <span>Overdue</span>
                </div>
                <div>
                  <span className="ic">
                    <Check size={12} />
                  </span>
                  <strong>{stats.verified}</strong>
                  <span>Verified</span>
                </div>
              </div>
            </section>

            <section className="mc-card rec-how-card">
              <McHead
                icon={<Info size={16} />}
                tone="navy"
                title="How actions are made"
                sub="Deterministic · no invented work"
              />
              <ol className="rec-how">
                <li>
                  <b>Read the evidence.</b> NVD severity, FIRST EPSS probability, CISA KEV status and the
                  installed version.
                </li>
                <li>
                  <b>Check exposure.</b> A version inside the affected range counts; a missing version asks for
                  confirmation instead of guessing.
                </li>
                <li>
                  <b>Set priority.</b> Known exploitation and critical systems rise to P1; the rest follow the
                  risk score.
                </li>
                <li>
                  <b>Prove the fix.</b> Completion waits for a person to check a rescan or a documented control.
                </li>
              </ol>
              <div className="rec-how-foot">
                <span className="badge real">NVD</span>
                <span className="badge real">FIRST EPSS</span>
                <span className="badge real">CISA KEV</span>
                <span className="badge simulated">Demo inventory</span>
              </div>
            </section>
          </div>

          <div className="mc-col-main">
            <section className="mc-card mc-hero-card">
              <McHead
                icon={<Activity size={17} />}
                tone="soft"
                title="Prevention pipeline"
                sub="Where the open work sits in its lifecycle"
                action={<span className="mc-chip">{recs.length} actions</span>}
              />
              <div className="mc-hero-body">
                <div className="mc-hero-left">
                  <div className="mc-big">
                    <span className="mc-big-num">
                      <Counter to={stats.open} />
                    </span>
                    <button
                      className="mc-details"
                      onClick={() => document.getElementById('action-queue')?.scrollIntoView({ behavior: 'smooth' })}
                    >
                      Details
                    </button>
                  </div>
                  <div className="mc-big-label">
                    Open actions <span className="dim">· {stats.verified} verified</span>
                  </div>
                  <div className="mc-break">
                    {priorityOpen.map((p) => {
                      const share = (p.open / Math.max(1, stats.open)) * 100
                      return (
                        <div
                          className="mc-break-row"
                          key={p.priority}
                          style={{ '--tone': priorityColor(p.priority, theme) } as CSSProperties}
                        >
                          <div className="top">
                            <span>{PRIORITY_LABEL[p.priority]}</span>
                            <b>{share.toFixed(0)}%</b>
                          </div>
                          <div className="mc-break-track">
                            <i style={{ width: `${Math.max(2, share)}%` }} />
                          </div>
                          <div className="sub">{p.open} open actions</div>
                        </div>
                      )
                    })}
                  </div>
                </div>
                <div className="mc-hero-chart">
                  <Chart option={chartOption} height={286} />
                  <div className="rec-chart-legend">
                    {STATUS_ORDER.map((s) => (
                      <span key={s}>
                        <i style={{ background: statusColor(s, theme) }} />
                        {ACTION_STATUS_LABEL[s]}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
              <div className="mc-hero-foot">
                <div>
                  <span className="lab">Verified share</span>
                  <span className="val">{(stats.verifiedShare * 100).toFixed(0)}% of generated actions</span>
                </div>
                <div>
                  <span className="lab">Risk cleared</span>
                  <span className="val">{fmtScore(clearedRisk)} score points</span>
                </div>
                <div>
                  <span className="lab">Past due</span>
                  <span className="val">{stats.overdue} open actions</span>
                </div>
              </div>
            </section>

            <div className="mc-lower rec-lower">
              <section className="mc-card mc-exposure-card">
                <McHead
                  icon={<User size={16} />}
                  tone="soft"
                  title="Ownership"
                  sub="Open work by team"
                  action={<span className="mc-chip">n={teamRows.length}</span>}
                />
                <div className="mc-table" role="table" aria-label="Open actions by owning team">
                  <div className="mc-table-head" role="row">
                    <span role="columnheader">Team</span>
                    <span className="num" role="columnheader">
                      P1
                    </span>
                    <span className="num" role="columnheader">
                      Open
                    </span>
                  </div>
                  <div className="mc-table-body" role="rowgroup">
                    {teamRows.slice(0, 5).map((row) => (
                      <div className="mc-row" role="row" key={row.name}>
                        <span role="cell">
                          <span className="mc-sev">
                            <i style={{ background: row.p1 > 0 ? priorityColor('P1', theme) : '#c0c7d0' }} />
                            {row.name}
                          </span>
                        </span>
                        <span className="num" role="cell">
                          {row.p1}
                        </span>
                        <span className="num" role="cell">
                          {row.open}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </section>

              <section className="mc-card rec-attention-card">
                <McHead
                  icon={<ShieldAlert size={16} />}
                  tone="navy"
                  title="Attention now"
                  sub="P1 or past due"
                  action={<span className="mc-chip">n={attention.length}</span>}
                />
                <div className="rec-attention">
                  {attention.length === 0 ? (
                    <p className="rec-empty-line">No P1 or overdue actions right now.</p>
                  ) : (
                    attention.map((rec) => (
                      <button key={rec.id} className="rec-attention-row" onClick={() => openRec(rec)}>
                        <span className={cx('rec-pri', `is-${rec.priority.toLowerCase()}`)}>{rec.priority}</span>
                        <span className="rec-attention-copy">
                          <strong>{rec.title}</strong>
                          <small>
                            {rec.team} · {isOverdue(rec, statusOf(rec.id)) ? 'past due' : 'due'}{' '}
                            {fmtDateShort(rec.due)}
                          </small>
                        </span>
                        <ArrowRight size={12} />
                      </button>
                    ))
                  )}
                </div>
              </section>
            </div>
          </div>
        </div>

        <div className="mc-stack rec-stack">
          <Panel
            id="action-queue"
            className="col-12 rec-queue-panel"
            title="Action queue"
            sub={`${rows.length} of ${recs.length} generated actions · every action is tied to a live alert`}
            action={<span className="badge real">Evidence-backed</span>}
            noPad
          >
            <div className="filters-bar rec-filters">
              <div className="topbar-search" style={{ maxWidth: 300 }}>
                <Search size={13} />
                <input
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="Filter CVE, asset, team…"
                  aria-label="Filter actions"
                />
              </div>
              <div className="seg">
                {(['ALL', ...PRIORITY_ORDER] as const).map((p) => (
                  <button
                    key={p}
                    className={priority === p ? 'on' : undefined}
                    onClick={() => setPriority(p as 'ALL' | RecommendationPriority)}
                  >
                    {p === 'ALL' ? 'All priorities' : p}
                  </button>
                ))}
              </div>
              <select
                className="select"
                style={{ width: 160 }}
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
                aria-label="Action status"
              >
                <option value="OPEN">Open only</option>
                <option value="ALL">All statuses</option>
                {STATUS_ORDER.map((s) => (
                  <option key={s} value={s}>
                    {ACTION_STATUS_LABEL[s]}
                  </option>
                ))}
              </select>
              <select
                className="select"
                style={{ width: 170 }}
                value={team}
                onChange={(e) => setTeam(e.target.value)}
                aria-label="Owning team"
              >
                <option value="ALL">All teams</option>
                {teams.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>

            {rows.length === 0 ? (
              <EmptyState
                title="No action matches this filter"
                hint="Clear the search, or switch back to open actions."
              />
            ) : (
              <div className="rec-list">
                {rows.map((rec, index) => {
                  const recStatus = statusOf(rec.id)
                  const entry = entries[rec.id]
                  const overdue = isOverdue(rec, recStatus)
                  const stale = isStale(rec, entry)
                  const alert = alerts.find((a) => a.id === rec.alertId)
                  const stage = alert
                    ? stageMeta(
                        warningStageFor(alert, {
                          acknowledged: true,
                          actionStatuses: recs
                            .filter((r) => r.alertId === alert.id)
                            .map((r) => statusOf(r.id)),
                        }),
                      )
                    : null
                  return (
                    <button
                      key={rec.id}
                      className={cx('rec-row', recStatus === 'VERIFIED' && 'is-verified')}
                      style={{ '--i': Math.min(index, 14) } as CSSProperties}
                      onClick={() => openRec(rec)}
                    >
                      <span className={cx('rec-pri', `is-${rec.priority.toLowerCase()}`)}>
                        {rec.priority}
                      </span>
                      <span className="rec-row-main">
                        <span className="rec-row-top">
                          <strong>{rec.title}</strong>
                          <span className={cx('rec-kind', KIND_TONE[rec.kind])}>{KIND_LABEL[rec.kind]}</span>
                          {stale && <span className="rec-flag is-stale">Evidence changed</span>}
                          {overdue && <span className="rec-flag is-overdue">Past due</span>}
                        </span>
                        <span className="rec-row-meta">
                          <span className="mono">{rec.cveId}</span>
                          <span>·</span>
                          <span>{rec.assetName}</span>
                          <span>·</span>
                          <span>{rec.team}</span>
                          {stage && (
                            <>
                              <span>·</span>
                              <span className="rec-stage" style={{ color: stage.color }}>
                                {stage.short}
                              </span>
                            </>
                          )}
                        </span>
                        <span className="rec-evidence">
                          {rec.evidence.slice(0, 3).map((e) => (
                            <span key={e.label}>
                              {e.label} <b>{e.value}</b>
                            </span>
                          ))}
                        </span>
                      </span>
                      <span className="rec-row-side">
                        <span className={cx('rec-status', `is-${recStatus.toLowerCase()}`)}>
                          {ACTION_STATUS_LABEL[recStatus]}
                        </span>
                        <span className="rec-due">{fmtDateShort(rec.due)}</span>
                        <SeverityBadge level={rec.level} />
                      </span>
                    </button>
                  )
                })}
              </div>
            )}
            <div className="table-note">
              <span className="inline-flex">
                <Info size={11} /> Actions are regenerated from live alert evidence each time the data refreshes.
                Your status, owner, notes and verification are kept against a stable action id.
              </span>
              <span className="mono">{DEMO_NOW.toISOString().slice(0, 10)}</span>
            </div>
          </Panel>

          <Panel
            className="col-7 rec-lifecycle-card"
            title="The lifecycle, and why it is strict"
            sub="Completion is a claim; verification is evidence"
            bodyClass="rec-lifecycle-body"
          >
            <div className="rec-lifecycle">
              {ACTION_STEPS.map((s, i) => (
                <div className="rec-lifecycle-step" key={s.key} style={{ '--i': i } as CSSProperties}>
                  <span className="rec-lifecycle-num">{String(i + 1).padStart(2, '0')}</span>
                  <div>
                    <strong>{s.label}</strong>
                    <p>{s.hint}</p>
                  </div>
                </div>
              ))}
            </div>
          </Panel>

          <Panel
            className="col-5 rec-warning-card"
            title="Warning stages this feeds"
            sub="How prevention changes an alert"
            bodyClass="rec-stage-body"
          >
            <div className="rec-stage-list">
              {(['MATCHED', 'ELEVATED', 'WARNING', 'PREVENT', 'MONITORING', 'REDUCED'] as const).map((key) => {
                const meta = stageMeta(key)
                return (
                  <div className="rec-stage-row" key={key}>
                    <i style={{ background: meta.color }} />
                    <div>
                      <strong>{meta.label}</strong>
                      <p>{meta.description}</p>
                    </div>
                  </div>
                )
              })}
            </div>
          </Panel>
        </div>
      </div>

      <Drawer
        wide
        board
        open={Boolean(selected)}
        onClose={closeRec}
        label={selected ? selected.title : 'Preventive action'}
      >
        {selected && (
          <ActionDetail
            rec={selected}
            alert={alerts.find((a) => a.id === selected.alertId)}
            status={status}
            entry={entries[selected.id]}
            recStatuses={recs.filter((r) => r.alertId === selected.alertId).map((r) => statusOf(r.id))}
            user={displayName}
            onClose={closeRec}
            onOpenAlert={() => {
              closeRec()
              navigate(`/app/alerts?alert=${selected.alertId}`)
            }}
            onStatus={(next) => {
              useActions.getState().setStatus(selected.id, next, displayName)
              toast(`Action marked ${ACTION_STATUS_LABEL[next].toLowerCase()}`)
            }}
            onAssign={(owner) => {
              useActions.getState().assign(selected.id, owner, displayName)
              toast(`Assigned to ${owner}`)
            }}
            onNote={(note) => {
              useActions.getState().addNote(selected.id, displayName, note)
              toast('Note added to the action record')
            }}
            onVerify={(note) => {
              useActions.getState().verify(selected.id, displayName, note, selected.evidenceKey)
              toast('Action verified against the current evidence')
            }}
            onReopen={(why) => {
              useActions.getState().reopen(selected.id, displayName, why)
              toast('Action reopened')
            }}
            teams={teams}
          />
        )}
      </Drawer>
    </div>
  )
}

/* ------------------------------------------------------------------ */

const priorityColor = (p: RecommendationPriority, theme: 'dark' | 'light') =>
  p === 'P1'
    ? '#e5545a'
    : p === 'P2'
      ? '#e08a2f'
      : p === 'P3'
        ? theme === 'dark'
          ? '#a9c2da'
          : '#14263e'
        : theme === 'dark'
          ? '#6f8499'
          : '#8d99a8'

const statusColor = (s: ActionStatus, theme: 'dark' | 'light') =>
  s === 'COMPLETED' ? (theme === 'dark' ? '#a9c2da' : '#14263e') : STATUS_COLORS[s]

function ActionDetail({
  rec,
  alert,
  status,
  entry,
  recStatuses,
  user,
  teams,
  onClose,
  onOpenAlert,
  onStatus,
  onAssign,
  onNote,
  onVerify,
  onReopen,
}: {
  rec: Recommendation
  alert?: Alert
  status: ActionStatus
  entry?: {
    owner?: string
    notes: { by: string; at: string; text: string }[]
    verifiedAt?: string
    verifiedBy?: string
    verifiedNote?: string
    evidenceKey?: string
  }
  recStatuses: ActionStatus[]
  user: string
  teams: string[]
  onClose: () => void
  onOpenAlert: () => void
  onStatus: (status: Exclude<ActionStatus, 'VERIFIED'>) => void
  onAssign: (owner: string) => void
  onNote: (note: string) => void
  onVerify: (note: string) => void
  onReopen: (why: string) => void
}) {
  const [verifyNote, setVerifyNote] = useState('')
  const [note, setNote] = useState('')
  const stage = alert
    ? stageMeta(warningStageFor(alert, { acknowledged: true, actionStatuses: recStatuses }))
    : null
  const overdue = isOverdue(rec, status)
  const stale = isStale(rec, entry ? { status, evidenceKey: entry.evidenceKey } : undefined)
  const stepIndex = ACTION_STEPS.findIndex((s) => s.key === status)
  const notes = entry?.notes ?? []

  return (
    <>
      <DrawerHead
        overline={`${rec.cveId} · ${rec.assetName} · ${rec.department}`}
        title={
          <span className="inline-flex" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            {rec.title}
          </span>
        }
        onClose={onClose}
        meta={
          <span className="inline-flex" style={{ flexWrap: 'wrap', gap: 6 }}>
            <span className={cx('rec-pri', `is-${rec.priority.toLowerCase()}`)}>{PRIORITY_LABEL[rec.priority]}</span>
            <span className={cx('rec-kind', KIND_TONE[rec.kind])}>{KIND_LABEL[rec.kind]}</span>
            {stage && <span className="badge medium">{stage.label}</span>}
            {overdue && <span className="badge critical">Past due</span>}
          </span>
        }
      />
      <div className="drawer-body">
        <div className="drawer-section">
          <h3>Where this action stands</h3>
          <div className="rec-steps" style={{ '--step': stepIndex } as CSSProperties}>
            <div className="rec-steps-track" aria-hidden="true">
              <i style={{ width: `${(stepIndex / (ACTION_STEPS.length - 1)) * 100}%` }} />
            </div>
            {ACTION_STEPS.map((s, i) => (
              <div
                key={s.key}
                className={cx(
                  'rec-step',
                  i < stepIndex && 'is-done',
                  i === stepIndex && 'is-current',
                  status === 'VERIFIED' && 'is-verified',
                )}
              >
                <span className="rec-step-dot">{i < stepIndex || status === 'VERIFIED' ? <Check size={10} /> : i + 1}</span>
                <span className="rec-step-label">{s.label}</span>
              </div>
            ))}
          </div>
          {stale && (
            <div className="rec-stale-note">
              <RefreshCw size={12} /> The evidence behind this action changed after it was last updated. Re-check
              before verifying.
            </div>
          )}
        </div>

        <div className="drawer-section">
          <h3>What this action asks for</h3>
          <div className="bd-action">
            <span className="bd-kicker">{PRIORITY_LABEL[rec.priority]} · owner {entry?.owner ?? rec.team}</span>
            <strong>{rec.title}</strong>
            <span className="bd-due">Due {fmtDate(rec.due)}</span>
            <p>{rec.detail}</p>
          </div>
          <div className="rec-chips">
            {rec.rationale.map((r) => (
              <span className="bd-chip" key={r}>
                {r}
              </span>
            ))}
          </div>
        </div>

        <div className="drawer-section">
          <h3>Evidence behind it</h3>
          <div className="bd-stats">
            {rec.evidence.map((e) => (
              <BoardStat
                key={e.label}
                label={e.label}
                value={e.value}
                tone={e.label === 'Known exploited' && rec.kev ? 'orange' : undefined}
              />
            ))}
          </div>
          {alert && (
            <div className="rec-score-line">
              <span>
                Alert score <b>{fmtScore(alert.score)}</b> · {levelLabel[alert.level]} risk
              </span>
              <span className="rec-score-track" aria-hidden="true">
                <i
                  style={{
                    width: `${Math.max(2, alert.score)}%`,
                    background: levelColor[alert.level],
                  }}
                />
              </span>
            </div>
          )}
          <p className="rec-source-note">
            Raised {timeAgo(rec.createdAt, DEMO_NOW)} from NVD, FIRST EPSS and CISA KEV. No step here is invented:
            each part traces back to the alert evidence shown above.
          </p>
        </div>

        <div className="drawer-section">
          <h3>Done means</h3>
          <div className="rec-verify-block">
            <span className="bd-kicker">Verification check</span>
            <p>{rec.verification}</p>
          </div>
        </div>

        <div className="drawer-section">
          <h3>Move the action</h3>
          <div className="rec-controls">
            {status === 'NEW' && (
              <button className="bd-btn" onClick={() => onStatus('ACCEPTED')}>
                <Check size={13} /> Accept action
              </button>
            )}
            {status === 'ACCEPTED' && (
              <button className="bd-btn" onClick={() => onStatus('IN_PROGRESS')}>
                <Activity size={13} /> Start work
              </button>
            )}
            {status === 'IN_PROGRESS' && (
              <button className="bd-btn" onClick={() => onStatus('COMPLETED')}>
                <Check size={13} /> Mark complete
              </button>
            )}
            {status === 'VERIFIED' && (
              <button className="bd-btn" onClick={() => onReopen('Fix could not be confirmed on a fresh check.')}>
                <RefreshCw size={13} /> Reopen action
              </button>
            )}
            {status === 'COMPLETED' && (
              <span className="rec-awaiting">Reported complete. Waiting for a person to verify it.</span>
            )}
          </div>

          {status === 'COMPLETED' && (
            <div className="rec-verify-form">
              <label htmlFor="rec-verify-note">
                What did you check? <span>Required before the action can be verified.</span>
              </label>
              <textarea
                id="rec-verify-note"
                rows={3}
                value={verifyNote}
                onChange={(e) => setVerifyNote(e.target.value)}
                placeholder={rec.verification}
              />
              <button
                className="bd-btn"
                disabled={verifyNote.trim().length < 8}
                onClick={() => {
                  onVerify(verifyNote.trim())
                  setVerifyNote('')
                }}
              >
                <ShieldCheck size={13} /> Verify against evidence
              </button>
              <button className="rec-link-btn" onClick={() => onReopen('Completion was not accepted.')}>
                Completion not accepted — reopen
              </button>
            </div>
          )}

          {status !== 'VERIFIED' && (
            <div className="rec-assign">
              <label htmlFor="rec-owner">Owner</label>
              <select
                id="rec-owner"
                className="select"
                value={entry?.owner ?? rec.team}
                onChange={(e) => onAssign(e.target.value)}
              >
                {[...new Set([rec.team, ...teams])].map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>

        {status === 'VERIFIED' && entry?.verifiedAt && (
          <div className="drawer-section">
            <h3>Verification</h3>
            <div className="bd-ack">
              <div className="inline-flex" style={{ gap: 8, alignItems: 'center' }}>
                <Check size={14} className="check" />
                <strong>Verified by {entry.verifiedBy}</strong>
              </div>
              <p>
                {new Date(entry.verifiedAt).toLocaleString('en-US')}
                {entry.verifiedNote ? ` · ${entry.verifiedNote}` : ''}
              </p>
            </div>
          </div>
        )}

        <div className="drawer-section">
          <h3>Notes</h3>
          <div className="rec-notes">
            {notes.length === 0 && <p className="rec-source-note">No notes yet. Add the first update below.</p>}
            {notes
              .slice()
              .reverse()
              .map((n, i) => (
                <div className="rec-note" key={`${n.at}-${i}`}>
                  <div className="rec-note-head">
                    <strong>{n.by}</strong>
                    <span>{new Date(n.at).toLocaleString('en-US')}</span>
                  </div>
                  <p>{n.text}</p>
                </div>
              ))}
          </div>
          <div className="rec-note-form">
            <textarea
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Add an update for the next person…"
              aria-label="Add a note"
            />
            <button
              className="bd-btn"
              disabled={note.trim().length < 3}
              onClick={() => {
                onNote(note.trim())
                setNote('')
              }}
            >
              Add note
            </button>
          </div>
        </div>

        <div className="drawer-section">
          <h3>Linked warning</h3>
          <button className="bd-btn" onClick={onOpenAlert}>
            <ExternalLink size={13} /> Open the alert for {rec.assetName}
          </button>
        </div>
      </div>
      <div className="drawer-foot">
        <span>{rec.id}</span>
        <span>NVD · FIRST EPSS · CISA KEV</span>
      </div>
    </>
  )
}
