import { useMemo, useState, type CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'
import { PageHeader, Panel } from '../../components/Panel'
import { StatsPanel } from '../../components/StatsPanel'
import { SeverityBadge, RelevanceBadge, SimulatedBadge } from '../../components/Badges'
import {
  ArrowRight,
  Boxes,
  Bug,
  Database,
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
} from '../../components/Icons'
import { IsoGraph } from '../../components/IsoGraph'
import { NodeWorkbench } from '../../components/NodeWorkbench'
import { DEMO_NOW } from '../../data/seed'
import { useCorrelationModel } from '../../lib/correlation'
import { latestLiveFetch, useLiveFeeds } from '../../lib/liveFeeds'
import { useFilters } from '../../lib/store'
import { cx, fmtPct, fmtScore, timeAgo } from '../../lib/format'
import { LEVEL_COLORS, levelColor } from '../../lib/colors'

const ASSET_ICONS = {
  app: Boxes,
  server: Server,
  network: Shield,
  database: Database,
  cloud: Globe2,
  endpoint: LayoutGrid,
} as const

export default function Graph() {
  const navigate = useNavigate()
  const query = useFilters((s) => s.query)
  const setQuery = useFilters((s) => s.setQuery)
  const [hover, setHover] = useState<string | null>(null)
  const [selected, setSelected] = useState<string>('hub')
  const [workbenchOpen, setWorkbenchOpen] = useState(false)

  const model = useCorrelationModel()
  const syncing = useLiveFeeds((s) => s.syncing)
  const phase = useLiveFeeds((s) => s.phase)
  const liveMeta = useLiveFeeds((s) => s.meta)
  const syncAll = useLiveFeeds((s) => s.syncAll)
  const lastFetch = latestLiveFetch(liveMeta)

  const openNode = (id: string) => {
    setSelected(id)
    setWorkbenchOpen(true)
  }

  const focusedAsset = model.assets.find((asset) => asset.id === selected)
  const focusedCve = model.cves.find((cve) => cve.id === selected)
  const isHub = !focusedAsset && !focusedCve

  const focusedAlerts = useMemo(() => {
    if (isHub) return model.alerts.slice(0, 4)
    return model.alerts.filter((alert) => alert.asset.id === selected || alert.cve.id === selected)
  }, [model, selected, isHub])

  const focusedTitle = focusedAsset?.name ?? focusedCve?.id ?? 'AEGIS core'
  const focusedMeta = focusedAsset
    ? `${focusedAsset.department} · ${focusedAsset.type} · ${focusedAsset.criticality}`
    : focusedCve
      ? `${focusedCve.vendor} ${focusedCve.product} · CVSS ${focusedCve.cvss?.toFixed(1) ?? '—'}`
      : `${model.assets.length} assets · ${model.cves.length} CVEs · ${model.alerts.length} correlation paths`

  const worst = focusedAsset
    ? ((model.alertsByAsset.get(focusedAsset.id) ?? []).find((alert) => !alert.suppressed) ?? null)
    : null

  const AssetIcon = focusedAsset ? ASSET_ICONS[focusedAsset.type] : Server
  const nodeCount = model.assets.length + model.cves.length + 1
  const density = (
    (2 * model.alerts.length) / nodeCount / (model.assets.length + model.cves.length)
  ).toFixed(4)

  return (
    <div className="page">
      <PageHeader
        eyebrow="COMPONENT 04 · NETWORK GRAPH"
        title="The mesh behind every alert"
        description="A simulated inventory rendered as an isometric exposure mesh. Asset nodes connect to live CVE nodes through version-gated correlation edges, enriched by NVD, CISA KEV and FIRST EPSS. Hover to trace a neighbourhood; tap any node to open its analysis workbench."
        actions={
          <>
            <span className="chip">
              <Network size={12} /> {model.alerts.length} correlation paths
            </span>
            <span className="chip">
              <ShieldAlert size={12} /> {model.counts.assetsWithHazards} assets with hazards
            </span>
            <span className="chip chip-live" title={lastFetch ? `Live pull ${lastFetch}` : 'No live pull yet'}>
              <i className={cx('chip-live-dot', lastFetch && 'on')} />
              {syncing
                ? `syncing ${phase ?? 'feeds'}`
                : lastFetch
                  ? `live · ${timeAgo(lastFetch)}`
                  : 'seed snapshot'}
            </span>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => void syncAll({ force: true })}
              disabled={syncing}
              aria-busy={syncing}
            >
              <RefreshCw size={13} className={syncing ? 'spin' : undefined} />
              {syncing ? 'Syncing' : 'Sync feeds'}
            </button>
          </>
        }
      />

      <div className="dash-grid">
        <Panel
          className="col-8 mesh-panel"
          title="Exposure mesh"
          sub="Inner ring · critical systems     Outer ring · supporting estate"
          action={
            <div className="topbar-search" style={{ maxWidth: 210, height: 30 }}>
              <Search size={12} />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Find asset or CVE…"
                aria-label="Find graph node"
              />
            </div>
          }
          noPad
        >
          <IsoGraph
            alerts={model.alerts}
            assets={model.assets}
            cves={model.cves}
            query={query}
            hover={hover}
            selected={selected}
            liveLabel={
              syncing
                ? `syncing ${phase ?? 'feeds'}`
                : lastFetch
                  ? `live · ${timeAgo(lastFetch)}`
                  : 'seed snapshot'
            }
            onHover={setHover}
            onSelect={openNode}
          />
        </Panel>

        <Panel
          className="col-4 mesh-inspector"
          title={focusedTitle}
          sub={focusedMeta}
          action={focusedCve ? <span className="badge real">live CVE record</span> : <SimulatedBadge />}
          bodyClass="panel-body"
        >
          <div className="mesh-inspector-body">
            {focusedAsset && (
              <>
                <div className="mesh-ident">
                  <span className="mesh-ident-icon" style={{ borderColor: worst ? 'rgba(255,95,109,.4)' : 'var(--line)' }}>
                    <AssetIcon size={22} strokeWidth={1.5} />
                  </span>
                  <div>
                    <span className="mesh-kicker">SIMULATED ASSET</span>
                    <div className="mesh-ident-name">{focusedAsset.businessFunction}</div>
                    <div className="mesh-pills">
                      <span className={`badge ${focusedAsset.criticality.toLowerCase()}`}>{focusedAsset.criticality}</span>
                      <span className={`badge ${focusedAsset.internetFacing ? 'high' : 'suppressed'}`}>
                        {focusedAsset.internetFacing ? 'Internet-facing' : 'Internal'}
                      </span>
                      <span className="badge suppressed">{focusedAsset.sensitivity} sensitivity</span>
                    </div>
                  </div>
                </div>
                <div className="mesh-facts">
                  <span><b>{focusedAlerts.length}</b> paths</span>
                  <span><b>{focusedAsset.software.length}</b> packages</span>
                  <span><b>{worst ? fmtScore(worst.score) : '—'}</b> worst score</span>
                </div>
              </>
            )}

            {focusedCve && (
              <>
                <div className="mesh-ident">
                  <span className="mesh-ident-icon" style={{ borderColor: `${LEVEL_COLORS[focusedCve.severity]}66` }}>
                    <Bug size={22} strokeWidth={1.5} />
                  </span>
                  <div>
                    <span className="mesh-kicker">NVD RECORD · LIVE ENRICHED</span>
                    <div className="mesh-ident-name">{focusedCve.title}</div>
                    <div className="mesh-pills">
                      <SeverityBadge level={focusedCve.severity} />
                      {focusedCve.kev && <span className="badge critical">CISA KEV</span>}
                      <span className="badge suppressed">{focusedCve.cwe[0]}</span>
                    </div>
                  </div>
                </div>
                <div className="mesh-facts">
                  <span><b>{focusedCve.cvss?.toFixed(1) ?? '—'}</b> cvss</span>
                  <span><b>{focusedCve.epss == null ? '—' : fmtPct(focusedCve.epss)}</b> epss</span>
                  <span><b>{focusedAlerts.length}</b> linked</span>
                </div>
              </>
            )}

            {isHub && (
              <>
                <div className="mesh-ident">
                  <span className="mesh-ident-icon mesh-ident-core">
                    <Network size={22} strokeWidth={1.5} />
                  </span>
                  <div>
                    <span className="mesh-kicker">CORRELATION CORE</span>
                    <div className="mesh-ident-name">Version-gated correlation across the simulated estate.</div>
                    <div className="mesh-pills">
                      <span className="badge real">Live enrichment</span>
                      <span className="badge suppressed">Deterministic seed</span>
                    </div>
                  </div>
                </div>
                <div className="mesh-facts">
                  <span><b>{model.assets.length}</b> assets</span>
                  <span><b>{model.cves.length}</b> cves</span>
                  <span><b>{model.alerts.length}</b> paths</span>
                </div>
              </>
            )}

            {focusedAlerts.length > 0 ? (
              <div className="mesh-alert-stack">
                <div className="mesh-section-label">
                  {isHub ? 'Highest-priority paths' : focusedAsset ? 'Connected hazards' : 'Linked paths'}
                  <span>{focusedAlerts.length}</span>
                </div>
                {focusedAlerts.map((alert) => (
                  <button
                    key={alert.id}
                    className="mesh-alert"
                    onClick={() => navigate(`/app/alerts?alert=${alert.id}`)}
                    style={{ '--alert-tone': levelColor(alert.level, alert.suppressed) } as CSSProperties}
                  >
                    <span className="mesh-alert-rail" />
                    <span className="mesh-alert-main">
                      <span className="mesh-alert-top">
                        <strong>{focusedCve ? alert.asset.name : alert.cve.id}</strong>
                        <SeverityBadge level={alert.level} suppressed={alert.suppressed} />
                      </span>
                      <span className="mesh-alert-sub">
                        {focusedCve ? alert.cve.product : alert.asset.department} · {alert.relevance.replace(/_/g, ' ')}
                      </span>
                    </span>
                    <span className={`score-cell ${alert.suppressed ? 'suppressed' : alert.level.toLowerCase()}`}>
                      {fmtScore(alert.score)}
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="mesh-empty">
                <Info size={14} />
                <div>
                  <strong>No inventory hit yet.</strong>
                  <p>
                    This CVE has no correlated asset path in the mesh, so it is drawn as an unlinked shard rather than a
                    hazard attached to a platform.
                  </p>
                </div>
              </div>
            )}

            <button className="mesh-workbench-cta" onClick={() => setWorkbenchOpen(true)}>
              <Sparkles size={13} />
              {isHub ? 'Open core workbench' : focusedCve ? 'Open CVE workbench' : 'Open asset workbench'}
              <ArrowRight size={11} />
            </button>

            {focusedCve && (
              <button className="mesh-inspect-link" onClick={() => navigate('/app/cves')}>
                Open CVE explorer <ArrowRight size={12} />
              </button>
            )}
            {focusedAsset && (
              <button className="mesh-inspect-link" onClick={() => navigate('/app/assets')}>
                Open asset inventory <ArrowRight size={12} />
              </button>
            )}
            {isHub && (
              <button className="mesh-inspect-link" onClick={() => navigate('/app/alerts')}>
                Open alert center <ArrowRight size={12} />
              </button>
            )}
          </div>
        </Panel>

        <Panel
          className="col-12"
          title="Correlation edges"
          sub={`${model.counts.active} active · ${model.counts.suppressed} suppressed · ${model.counts.unlinked} CVEs with no inventory hit · ${model.counts.kev} KEV-backed`}
          action={
            lastFetch ? (
              <span className="badge real">live CVE fields</span>
            ) : (
              <span className="badge simulated">seed snapshot</span>
            )
          }
          noPad
        >
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>CVE</th>
                  <th>Asset</th>
                  <th>Relevance</th>
                  <th>Level</th>
                  <th className="right col-sm-hide">CVSS</th>
                  <th className="right col-sm-hide">EPSS</th>
                  <th className="right">Score</th>
                  <th className="right col-sm-hide">Raised</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {model.alerts.map((alert) => (
                  <tr key={alert.id} className="clickable" onClick={() => openNode(alert.asset.id)}>
                    <td className="mono">
                      <span className="edge-dot" style={{ background: levelColor(alert.level, alert.suppressed) }} />
                      {alert.cve.id}
                    </td>
                    <td>
                      <div className="cell-title">{alert.asset.name}</div>
                      <div className="cell-sub">{alert.asset.department}</div>
                    </td>
                    <td>
                      <RelevanceBadge relevance={alert.relevance} />
                    </td>
                    <td>
                      <SeverityBadge level={alert.level} suppressed={alert.suppressed} />
                    </td>
                    <td className="right mono col-sm-hide">{alert.cve.cvss?.toFixed(1) ?? '—'}</td>
                    <td className="right mono col-sm-hide">{alert.cve.epss == null ? '—' : fmtPct(alert.cve.epss)}</td>
                    <td className="right">
                      <span className={`score-cell ${alert.suppressed ? 'suppressed' : alert.level.toLowerCase()}`}>
                        {fmtScore(alert.score)}
                      </span>
                    </td>
                    <td className="right mono col-sm-hide">{timeAgo(alert.createdAt, DEMO_NOW)}</td>
                    <td className="right">
                      <button
                        className="panel-link"
                        onClick={(ev) => {
                          ev.stopPropagation()
                          navigate(`/app/alerts?alert=${alert.id}`)
                        }}
                      >
                        {alert.id} <ArrowRight size={11} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="table-note">
            <span className="inline-flex">
              <Info size={11} /> Suppressed hazards remain drawn on the mesh so the relevance gate stays auditable.
            </span>
            <span className="mono">
              <ShieldAlert size={10} style={{ display: 'inline', marginRight: 4 }} />
              {model.counts.suppressed} suppressed edges
            </span>
          </div>
        </Panel>

        <StatsPanel
          className="col-12"
          stats={[
            { name: 'Graph density', value: density, formula: '2E ÷ V(V−1)', n: nodeCount },
            {
              name: 'Mean edges per asset',
              value: (model.alerts.length / model.assets.length).toFixed(2),
              formula: `edges ÷ ${model.assets.length} assets`,
              n: model.assets.length,
            },
            {
              name: 'Unlinked CVEs',
              value: String(model.counts.unlinked),
              formula: 'CVEs with no inventory hit',
              n: model.cves.length,
            },
            {
              name: 'Suppressed edges',
              value: String(model.counts.suppressed),
              formula: 'relevance gate applied',
              n: model.alerts.length,
            },
            {
              name: 'KEV-backed paths',
              value: String(model.counts.kev),
              formula: 'active alerts with cve.kev',
              n: model.alerts.length,
            },
          ]}
        />
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
