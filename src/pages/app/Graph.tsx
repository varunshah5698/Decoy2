import { memo, useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'
import { Panel } from '../../components/Panel'
import { SeverityBadge, RelevanceBadge, SimulatedBadge } from '../../components/Badges'
import {
  ArrowRight,
  Boxes,
  Bug,
  Crosshair,
  Database,
  Gauge,
  Globe2,
  Info,
  LayoutGrid,
  Network,
  RefreshCw,
  Search,
  Server,
  Shield,
  ShieldAlert,
  Sparkles,
  Zap,
} from '../../components/Icons'
import { ForceGraph } from '../../components/ForceGraph'
import { NodeWorkbench } from '../../components/NodeWorkbench'
import { RISK_ORDER } from '../../lib/correlation'
import type { Alert } from '../../lib/types'
import { useEstate } from '../../lib/estate'
import { LIVE_SOURCES, latestLiveFetch, useLiveFeeds } from '../../lib/liveFeeds'
import { useFilters, useTheme } from '../../lib/store'
import { cx, fmtPct, fmtScore, timeAgo } from '../../lib/format'
import { LEVEL_COLORS, levelColor } from '../../lib/colors'
import './graph.css'

const ASSET_ICONS = {
  app: Boxes,
  server: Server,
  network: Shield,
  database: Database,
  cloud: Globe2,
  endpoint: LayoutGrid,
} as const

const LEDGER_PAGE = 150

type Scope = 'all' | 'active' | 'critical' | 'kev' | 'suppressed'

/* Hover moves the rail on every pointer change; the 150-row ledger below does not depend on it,
   so it is memoised as its own component and stays out of that repaint. */
const LedgerRows = memo(function LedgerRows({
  alerts,
  now,
  onOpenAsset,
  onOpenAlert,
}: {
  alerts: Alert[]
  now: number
  onOpenAsset: (id: string) => void
  onOpenAlert: (id: string) => void
}) {
  return (
    <tbody>
      {alerts.map((alert) => (
        <tr
          key={alert.id}
          className="clickable ledger-row"
          onClick={() => onOpenAsset(alert.asset.id)}
          style={{ '--row-tone': levelColor(alert.level, alert.suppressed) } as CSSProperties}
        >
          <td className="mono">
            <span className="edge-dot" style={{ background: levelColor(alert.level, alert.suppressed) }} />
            {alert.cve.id}
          </td>
          <td>
            <div className="cell-title">{alert.asset.name}</div>
            <div className="cell-sub">{alert.asset.department}</div>
          </td>
          <td className="col-sm-hide">
            <RelevanceBadge relevance={alert.relevance} />
          </td>
          <td className="col-sm-hide">
            <SeverityBadge level={alert.level} suppressed={alert.suppressed} />
          </td>
          <td className="right mono col-sm-hide">{alert.cve.cvss?.toFixed(1) ?? '—'}</td>
          <td className="right mono col-sm-hide">
            {alert.cve.epss == null ? '—' : fmtPct(alert.cve.epss)}
          </td>
          <td className="right">
            <span className={`score-cell ${alert.suppressed ? 'suppressed' : alert.level.toLowerCase()}`}>
              {fmtScore(alert.score)}
            </span>
          </td>
          <td className="right mono col-sm-hide">{timeAgo(alert.createdAt, now)}</td>
          <td className="right col-sm-hide">
            <button className="panel-link" onClick={(ev) => { ev.stopPropagation(); onOpenAlert(alert.id) }}>
              {alert.id} <ArrowRight size={11} />
            </button>
          </td>
        </tr>
      ))}
    </tbody>
  )
})

const SCOPES: { key: Scope; label: string }[] = [
  { key: 'all', label: 'All paths' },
  { key: 'active', label: 'Active' },
  { key: 'critical', label: 'Critical' },
  { key: 'kev', label: 'KEV' },
  { key: 'suppressed', label: 'Suppressed' },
]

const RING = 2 * Math.PI * 46

const relativeTime = (iso: string) => {
  const label = timeAgo(iso)
  return label.startsWith('0m') ? 'just now' : label
}

export default function Graph() {
  const navigate = useNavigate()
  const setTheme = useTheme((s) => s.setTheme)
  const query = useFilters((s) => s.query)
  const setQuery = useFilters((s) => s.setQuery)
  const [hover, setHover] = useState<string | null>(null)
  const [selected, setSelected] = useState<string>('hub')
  const [workbenchOpen, setWorkbenchOpen] = useState(false)
  const [scope, setScope] = useState<Scope>('all')

  const estate = useEstate()
  const model = estate.model
  const syncing = useLiveFeeds((s) => s.syncing)
  const phase = useLiveFeeds((s) => s.phase)
  const progress = useLiveFeeds((s) => s.progress)
  const liveMeta = useLiveFeeds((s) => s.meta)
  const syncAll = useLiveFeeds((s) => s.syncAll)
  const lastFetch = latestLiveFetch(liveMeta)
  const pullLabel = lastFetch ? relativeTime(lastFetch) : null

  const openNode = useCallback((id: string) => {
    setSelected(id)
    setWorkbenchOpen(true)
  }, [])

  const openAlert = useCallback((id: string) => navigate(`/app/alerts?alert=${id}`), [navigate])

  // The graph is a light-skin surface: the cool-white canvas is what makes the
  // severity edges legible, and the workbench drawer portals to <body>, so the
  // skin has to live on the root element rather than inside this page.
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

  const activeAlerts = useMemo(() => model.alerts.filter((alert) => !alert.suppressed), [model.alerts])

  const scopeCounts = useMemo(
    () => ({
      all: model.alerts.length,
      active: model.counts.active,
      critical: model.counts.critical,
      kev: model.counts.kev,
      suppressed: model.counts.suppressed,
    }),
    [model],
  )

  const [ledgerLimit, setLedgerLimit] = useState(LEDGER_PAGE)
  useEffect(() => setLedgerLimit(LEDGER_PAGE), [scope, estate])

  const scopedAlerts = useMemo(() => {
    switch (scope) {
      case 'active':
        return activeAlerts
      case 'critical':
        return model.alerts.filter((alert) => !alert.suppressed && alert.level === 'CRITICAL')
      case 'kev':
        return model.alerts.filter((alert) => alert.cve.kev)
      case 'suppressed':
        return model.alerts.filter((alert) => alert.suppressed)
      default:
        return model.alerts
    }
  }, [activeAlerts, model.alerts, scope])

  /* The mesh is the estate: every host and every record in scope is laid out, and the renderer
     keeps that survivable by merging correlation edges into one path per severity and solving
     the big cases in frame-budgeted chunks. */
  const mesh = useMemo(() => ({ assets: model.assets, cves: model.cves, alerts: scopedAlerts }), [model, scopedAlerts])

  const ledgerRows = useMemo(() => scopedAlerts.slice(0, ledgerLimit), [scopedAlerts, ledgerLimit])

  const focusId = hover ?? selected
  const focusedAsset = model.assets.find((asset) => asset.id === focusId)
  const focusedCve = model.cves.find((cve) => cve.id === focusId)
  const isHub = !focusedAsset && !focusedCve

  const focusedAlerts = useMemo(() => {
    if (isHub) return activeAlerts.slice(0, 4)
    return model.alerts.filter((alert) => alert.asset.id === focusId || alert.cve.id === focusId)
  }, [model.alerts, activeAlerts, focusId, isHub])

  const focusedActive = useMemo(
    () =>
      focusedAlerts.filter((alert) => !alert.suppressed).sort((a, b) => b.score - a.score),
    [focusedAlerts],
  )

  const focusedTitle = focusedAsset?.name ?? focusedCve?.id ?? 'AEGIS core'
  const focusedMeta = focusedAsset
    ? `${focusedAsset.department} · ${focusedAsset.type} · ${focusedAsset.criticality} criticality`
    : focusedCve
      ? `${focusedCve.vendor} ${focusedCve.product} · CVSS ${focusedCve.cvss?.toFixed(1) ?? '—'} · ${focusedCve.kev ? 'CISA KEV' : 'not in KEV'}`
      : `${model.assets.length} assets · ${model.cves.length} CVEs · ${model.alerts.length} correlation paths`

  const worst = focusedActive[0] ?? null
  const meanActive = activeAlerts.length
    ? activeAlerts.reduce((sum, alert) => sum + alert.score, 0) / activeAlerts.length
    : 0
  const railScore = worst ? worst.score : meanActive
  const railLevel = worst?.level ?? activeAlerts[0]?.level ?? 'LOW'
  const railScoreLabel = worst ? (focusedAsset ? 'worst path' : 'highest linked') : 'graph mean'

  const AssetIcon = focusedAsset ? ASSET_ICONS[focusedAsset.type] : Server
  const FocusIcon = focusedAsset ? AssetIcon : focusedCve ? Bug : Network

  const nodeCount = mesh.assets.length + mesh.cves.length + 1
  const density = ((2 * mesh.alerts.length) / nodeCount / Math.max(1, mesh.assets.length + mesh.cves.length)).toFixed(4)

  const mix = [...RISK_ORDER].reverse().map((level) => ({
    level,
    count: activeAlerts.filter((alert) => alert.level === level).length,
  }))
  const mixMax = Math.max(1, ...mix.map((entry) => entry.count))

  const priority = activeAlerts.slice(0, 5)
  const feedRows = LIVE_SOURCES.map((source) => {
    const entry = liveMeta[source]
    return {
      source,
      live: entry?.status === 'ok',
      records: entry?.records,
      at: entry?.fetchedAt,
    }
  })

  const onHeroMove = (e: React.PointerEvent<HTMLElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    e.currentTarget.style.setProperty('--mx', `${e.clientX - rect.left}px`)
    e.currentTarget.style.setProperty('--my', `${e.clientY - rect.top}px`)
  }

  return (
    <div className="page graph-page">
      <section className="graph-hero" onPointerMove={onHeroMove}>
        <span className="graph-hero-grid" aria-hidden="true" />
        <span className="graph-hero-aura" aria-hidden="true" />
        <div className="graph-hero-copy">
          <span className="graph-eyebrow">
            <i className="graph-eyebrow-dot" /> Component 04 · Network graph
          </span>
          <h1>
            The graph behind <span>every alert.</span>
          </h1>
          <p>
            {estate.coverage.hasUploads
              ? 'Your uploaded estate laid out as a live force-directed graph: every host and every record settle themselves through version-gated correlation edges, then score against NVD, CISA KEV and FIRST EPSS.'
              : 'A simulated estate laid out as a live force-directed graph: assets and CVE records settle themselves through version-gated correlation edges, then score against NVD, CISA KEV and FIRST EPSS.'}
            <strong> Tap any node for its full workbench.</strong>
          </p>
        </div>

        <div className="graph-hero-deck">
          <div className="graph-sync">
            <span className={cx('graph-sync-dot', (lastFetch || syncing) && 'on')} />
            <div className="graph-sync-copy">
              <b>{syncing ? `Syncing ${phase ?? 'feeds'}` : lastFetch ? 'Live intelligence' : 'Seed snapshot'}</b>
              <span>
                {syncing && progress
                  ? `NVD record ${progress.done} of ${progress.total}`
                  : lastFetch
                    ? `Pulled ${pullLabel} · NVD / KEV / EPSS`
                    : 'No live pull yet this session'}
              </span>
            </div>
            <button
              className="graph-sync-btn"
              onClick={() => void syncAll({ force: true })}
              disabled={syncing}
              aria-busy={syncing}
              aria-label="Sync live feeds"
            >
              <RefreshCw size={14} className={syncing ? 'spin' : undefined} />
            </button>
          </div>

          <div className="graph-hero-stats">
            <div className="graph-hero-stat">
              <span>Paths</span>
              <b>{model.alerts.length}</b>
              <i>{model.counts.active} active</i>
            </div>
            <div className="graph-hero-stat">
              <span>Exposed assets</span>
              <b>{model.counts.assetsWithHazards}</b>
              <i>of {model.assets.length} in estate</i>
            </div>
            <div className="graph-hero-stat">
              <span>KEV-backed</span>
              <b>{model.counts.kev}</b>
              <i>actively exploited</i>
            </div>
          </div>
        </div>
      </section>

      <div className="dash-grid graph-deck">
        <Panel
          className="col-8 deck-mesh"
          title={
            <span className="deck-title">
              <Network size={14} /> Exposure graph
            </span>
          }
          sub="Assets · severity-stroked      CVEs · dashed when unmapped"
          action={
            <span className="deck-beta" title="Every host and record in scope is laid out; edges are merged by severity so a 1,000-host estate stays readable.">
              <i /> {mesh.assets.length} of {model.assets.length} assets · {mesh.alerts.length} of {model.alerts.length} paths
            </span>
          }
          noPad
        >
          <div className="deck-bar">
            <div className="scope-rail" role="tablist" aria-label="Filter correlation paths">
              {SCOPES.map((entry) => (
                <button
                  key={entry.key}
                  role="tab"
                  aria-selected={scope === entry.key}
                  className={cx('scope-chip', scope === entry.key && 'on')}
                  onClick={() => setScope(entry.key)}
                >
                  {entry.label}
                  <b>{scopeCounts[entry.key]}</b>
                </button>
              ))}
            </div>
            <div className="deck-search">
              <Search size={12} />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Find asset or CVE…"
                aria-label="Find graph node"
              />
            </div>
          </div>
          <div className="deck-canvas">
            <ForceGraph
              alerts={mesh.alerts}
              allAlerts={model.alerts}
              assets={mesh.assets}
              cves={mesh.cves}
              query={query}
              hover={hover}
              selected={selected}
              liveLabel={
                syncing
                  ? `syncing ${phase ?? 'feeds'}`
                  : lastFetch
                    ? `live · ${pullLabel}`
                    : 'seed snapshot'
              }
              onHover={setHover}
              onSelect={openNode}
            />
            {scopedAlerts.length === 0 && (
              <div className="deck-empty">
                <Crosshair size={18} />
                <strong>No paths in this scope</strong>
                <span>Switch the scope filter to repopulate the graph.</span>
                <button className="btn btn-ghost btn-sm" onClick={() => setScope('all')}>
                  Reset to all paths
                </button>
              </div>
            )}
          </div>
        </Panel>

        <aside className="col-4 graph-rail">
          <div className="rail-head">
            <div className="rail-ident">
              <span
                className="rail-icon"
                style={{ borderColor: `${levelColor(railLevel)}55`, color: levelColor(railLevel) }}
              >
                <FocusIcon size={20} strokeWidth={1.6} />
              </span>
              <div>
                <span className="rail-kicker">
                  {isHub ? 'Correlation core' : focusedAsset ? 'Asset node' : 'CVE node'} ·{' '}
                  {isHub ? 'AEGIS' : selected}
                </span>
                <h2 className="rail-title">{focusedTitle}</h2>
              </div>
            </div>
            <p className="rail-meta">{focusedMeta}</p>

            <div className="rail-pills">
              {focusedAsset && (
                <>
                  <span className={`badge ${focusedAsset.criticality.toLowerCase()}`}>{focusedAsset.criticality}</span>
                  <span className={`badge ${focusedAsset.internetFacing ? 'high' : 'suppressed'}`}>
                    {focusedAsset.internetFacing ? 'Internet-facing' : 'Internal'}
                  </span>
                  <span className="badge suppressed">{focusedAsset.sensitivity} sensitivity</span>
                </>
              )}
              {focusedCve && (
                <>
                  <SeverityBadge level={focusedCve.severity} />
                  {focusedCve.kev && <span className="badge critical">CISA KEV</span>}
                  <span className="badge suppressed">{focusedCve.cwe[0]}</span>
                </>
              )}
              {isHub && (
                <>
                  <span className="badge real">Live enrichment</span>
                  <span className="badge suppressed">Deterministic seed</span>
                  <span className="badge simulated">Formula v1.1</span>
                </>
              )}
            </div>
          </div>

          <div className="rail-score">
            <div className="rail-ring">
              <svg viewBox="0 0 120 120" role="img" aria-label={`${railScoreLabel} score ${railScore.toFixed(1)}`}>
                <circle cx="60" cy="60" r="46" className="rail-ring-track" />
                <circle
                  cx="60"
                  cy="60"
                  r="46"
                  className="rail-ring-value"
                  style={
                    {
                      stroke: levelColor(railLevel),
                      strokeDasharray: `${(Math.min(100, railScore) / 100) * RING} ${RING}`,
                    } as CSSProperties
                  }
                />
              </svg>
              <div className="rail-ring-mid">
                <b style={{ color: levelColor(railLevel) }}>{fmtScore(railScore)}</b>
                <span>{railScoreLabel}</span>
              </div>
            </div>
            <div className="rail-score-side">
              <span className="rail-kicker">Exposure posture</span>
              <strong className="rail-level" style={{ color: levelColor(railLevel) }}>
                {worst?.suppressed ? 'Suppressed' : railLevel}
              </strong>
              <p>
                {isHub
                  ? `${activeAlerts.length} active paths across ${model.counts.assetsWithHazards} exposed assets.`
                  : worst
                    ? `${worst.cve.id} · ${worst.relevance.replace(/_/g, ' ').toLowerCase()}`
                    : 'No active correlation path for this node.'}
              </p>
              <div className="rail-fact-row">
                {(focusedAsset
                  ? [
                      ['paths', String(focusedAlerts.length)],
                      ['packages', String(focusedAsset.software.length)],
                      ['hazards', String(focusedActive.length)],
                    ]
                  : focusedCve
                    ? [
                        ['cvss', focusedCve.cvss?.toFixed(1) ?? '—'],
                        ['epss', focusedCve.epss == null ? '—' : fmtPct(focusedCve.epss)],
                        ['linked', String(focusedAlerts.length)],
                      ]
                    : [
                        ['assets', String(model.assets.length)],
                        ['cves', String(model.cves.length)],
                        ['unlinked', String(model.counts.unlinked)],
                      ]
                ).map(([label, value]) => (
                  <span key={label}>
                    <b>{value}</b>
                    {label}
                  </span>
                ))}
              </div>
            </div>
          </div>

          <div className="rail-paths">
            <div className="rail-section">
              <span>
                {isHub ? 'Highest-priority paths' : focusedAsset ? 'Connected hazards' : 'Linked paths'}
              </span>
              <b>{focusedAlerts.length}</b>
            </div>
            {focusedAlerts.length === 0 ? (
              <div className="rail-empty">
                <Info size={13} />
                This CVE has no inventory hit, so it is drawn as an unlinked shard.
              </div>
            ) : (
              focusedAlerts.slice(0, 4).map((alert) => (
                <button
                  key={alert.id}
                  className="rail-path"
                  onClick={() => navigate(`/app/alerts?alert=${alert.id}`)}
                  style={{ '--tone': levelColor(alert.level, alert.suppressed) } as CSSProperties}
                >
                  <i />
                  <span className="rail-path-main">
                    <strong>{focusedCve ? alert.asset.name : alert.cve.id}</strong>
                    <small>
                      {focusedCve ? alert.cve.product : alert.asset.department} · {alert.relevance.replace(/_/g, ' ')}
                    </small>
                  </span>
                  <span className={`score-cell ${alert.suppressed ? 'suppressed' : alert.level.toLowerCase()}`}>
                    {fmtScore(alert.score)}
                  </span>
                </button>
              ))
            )}
          </div>

          <div className="rail-actions">
            <button className="btn btn-primary btn-sm rail-cta" onClick={() => openNode(focusId)}>
              <Sparkles size={13} />
              {isHub ? 'Open core workbench' : focusedCve ? 'Open CVE workbench' : 'Open asset workbench'}
              <ArrowRight size={11} />
            </button>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() =>
                navigate(focusedCve ? '/app/cves' : focusedAsset ? '/app/assets' : '/app/alerts')
              }
            >
              {focusedCve ? 'CVE explorer' : focusedAsset ? 'Asset inventory' : 'Alert center'}
              <ArrowRight size={11} />
            </button>
          </div>
        </aside>
      </div>

      <div className="dash-grid graph-signals">
        <Panel
          className="col-4 signal-panel"
          title="Risk distribution"
          sub={`${activeAlerts.length} active paths`}
          action={<span className="signal-mark">LIVE</span>}
        >
          <div className="mix-list">
            {mix.map((entry) => (
              <div className="mix-row" key={entry.level}>
                <span className="mix-label" style={{ color: LEVEL_COLORS[entry.level] }}>
                  {entry.level}
                </span>
                <span className="mix-track">
                  <i
                    style={{
                      width: `${(entry.count / mixMax) * 100}%`,
                      background: `linear-gradient(90deg, ${LEVEL_COLORS[entry.level]}55, ${LEVEL_COLORS[entry.level]})`,
                    }}
                  />
                </span>
                <b>{entry.count}</b>
              </div>
            ))}
          </div>
          <div className="mix-foot">
            <span>
              <ShieldAlert size={11} /> {model.counts.suppressed} suppressed by the relevance gate
            </span>
            <button className="panel-link" onClick={() => setScope('suppressed')}>
              inspect <ArrowRight size={10} />
            </button>
          </div>
        </Panel>

        <Panel
          className="col-4 signal-panel"
          title="Feed health"
          sub="Browser-cached live pulls"
          action={<span className={cx('signal-mark', syncing && 'busy')}>{syncing ? 'SYNC' : 'NVD · KEV · EPSS'}</span>}
        >
          <div className="feed-list">
            {feedRows.map((row) => (
              <div className="feed-row" key={row.source}>
                <span className={cx('feed-dot', row.live && 'on')} />
                <span className="feed-name">{row.source}</span>
                <span className="feed-state">{row.live ? `${row.records ?? 0} recs` : 'seed fallback'}</span>
                <span className="feed-time">{row.at ? relativeTime(row.at) : '—'}</span>
              </div>
            ))}
          </div>
          {syncing && progress && (
            <div className="feed-progress">
              <i style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }} />
            </div>
          )}
          <div className="mix-foot">
            <span>
              <Info size={11} /> NVD may fall back to seed when blocked by CORS.
            </span>
            <button className="panel-link" onClick={() => void syncAll({ force: true })} disabled={syncing}>
              <RefreshCw size={10} /> sync
            </button>
          </div>
        </Panel>

        <Panel
          className="col-4 signal-panel"
          title="Priority stack"
          sub="Top active paths in the window"
          action={<span className="signal-mark">{priority.length}</span>}
          bodyClass="signal-body"
          noPad
        >
          <div className="priority-list">
            {priority.map((alert, index) => (
              <button
                key={alert.id}
                className="priority-row"
                onClick={() => openNode(alert.asset.id)}
                style={{ '--tone': levelColor(alert.level, alert.suppressed) } as CSSProperties}
              >
                <span className="priority-rank">{String(index + 1).padStart(2, '0')}</span>
                <span className="priority-main">
                  <strong>{alert.cve.id}</strong>
                  <small>
                    {alert.asset.name} · {alert.asset.department}
                  </small>
                </span>
                <span className={`score-cell ${alert.level.toLowerCase()}`}>{fmtScore(alert.score)}</span>
              </button>
            ))}
          </div>
          <div className="mix-foot" style={{ padding: '10px 16px 14px' }}>
            <span>
              <Zap size={11} /> {model.counts.kev} KEV-backed paths
            </span>
            <button className="panel-link" onClick={() => navigate('/app/alerts')}>
              alert center <ArrowRight size={10} />
            </button>
          </div>
        </Panel>
      </div>

      <Panel
        className="col-12 graph-ledger"
        title="Correlation ledger"
        sub={`${scopedAlerts.length} of ${model.alerts.length} edges · ${model.counts.active} active · ${model.counts.suppressed} suppressed · ${model.counts.unlinked} unlinked CVEs`}
        action={
          <div className="ledger-head-actions">
            {scope !== 'all' && (
              <button className="ledger-reset" onClick={() => setScope('all')}>
                clear scope
              </button>
            )}
            {lastFetch ? (
              <span className="badge real">live CVE fields</span>
            ) : (
              <span className="badge simulated">seed snapshot</span>
            )}
          </div>
        }
        noPad
      >
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>CVE</th>
                <th>Asset</th>
                <th className="col-sm-hide">Relevance</th>
                <th className="col-sm-hide">Level</th>
                <th className="right col-sm-hide">CVSS</th>
                <th className="right col-sm-hide">EPSS</th>
                <th className="right">Score</th>
                <th className="right col-sm-hide">Raised</th>
                <th className="col-sm-hide" />
              </tr>
            </thead>
            <LedgerRows
              alerts={ledgerRows}
              now={estate.now}
              onOpenAsset={openNode}
              onOpenAlert={openAlert}
            />
          </table>
          {scopedAlerts.length === 0 && (
            <div className="ledger-empty">
              <Info size={13} /> No correlation edges in this scope.
              <button onClick={() => setScope('all')}>Reset filter</button>
            </div>
          )}
        </div>
        <div className="table-note">
          <span className="inline-flex">
            <Info size={11} /> Suppressed hazards stay drawn as dashed edges so the relevance gate stays auditable.
          </span>
          {scopedAlerts.length > ledgerLimit && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setLedgerLimit((v) => v + LEDGER_PAGE)}>
              Show {Math.min(LEDGER_PAGE, scopedAlerts.length - ledgerLimit)} of {scopedAlerts.length} edges
            </button>
          )}
          <span className="mono">
            <ShieldAlert size={10} style={{ display: 'inline', marginRight: 4 }} />
            {model.counts.suppressed} suppressed edges
          </span>
        </div>
      </Panel>

      <div className="graph-telemetry">
        <div className="telemetry-tile">
          <span className="telemetry-kicker">
            <Gauge size={11} /> Graph density
          </span>
          <b>{density}</b>
          <i>2E ÷ V(V−1) · mesh n={nodeCount}</i>
        </div>
        <div className="telemetry-tile">
          <span className="telemetry-kicker">
            <Network size={11} /> Mean edges per asset
          </span>
          <b>{(model.alerts.length / model.assets.length).toFixed(2)}</b>
          <i>edges ÷ {model.assets.length} assets</i>
        </div>
        <div className="telemetry-tile">
          <span className="telemetry-kicker">
            <Crosshair size={11} /> Unlinked CVEs
          </span>
          <b>{model.counts.unlinked}</b>
          <i>no inventory hit in the window</i>
        </div>
        <div className="telemetry-tile">
          <span className="telemetry-kicker">
            <Shield size={11} /> Suppressed edges
          </span>
          <b>{model.counts.suppressed}</b>
          <i>relevance gate applied</i>
        </div>
        <div className="telemetry-tile">
          <span className="telemetry-kicker">
            <Zap size={11} /> KEV-backed paths
          </span>
          <b>{model.counts.kev}</b>
          <i>active alerts with a KEV listing</i>
        </div>
      </div>

      <NodeWorkbench
        nodeId={workbenchOpen ? selected : null}
        model={model}
        onClose={() => setWorkbenchOpen(false)}
        onSelectNode={setSelected}
      />
    </div>
  )
}
