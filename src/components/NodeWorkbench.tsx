import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { Drawer, DrawerHead } from './Drawer'
import { RelevanceBadge, SeverityBadge, SimulatedBadge } from './Badges'
import { ArrowRight, ExternalLink, Info, RefreshCw, ShieldAlert } from './Icons'
import { fmtDate, fmtDateTime, fmtPct, fmtScore, timeAgo } from '../lib/format'
import { levelColor } from '../lib/colors'
import { latestLiveFetch, useLiveFeeds, type LiveCvePatch, type LiveSource, type LiveSourceMeta } from '../lib/liveFeeds'
import { rangeText, type CorrelationModel } from '../lib/correlation'
import { FORMULA_VERSION, WEIGHTS } from '../lib/scoring'
import { cx } from '../lib/format'
import type { Alert, Cve, RiskLevel } from '../lib/types'

type TabKey = 'overview' | 'connections' | 'evidence' | 'remediation'

const TABS: TabKey[] = ['overview', 'connections', 'evidence', 'remediation']

const SOURCES: LiveSource[] = ['NVD', 'CISA KEV', 'FIRST EPSS']

const LEVELS: RiskLevel[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']

export interface NodeWorkbenchProps {
  nodeId: string | null
  model: CorrelationModel
  onClose: () => void
  onSelectNode: (id: string) => void
}

export function NodeWorkbench({ nodeId, model, onClose, onSelectNode }: NodeWorkbenchProps) {
  const navigate = useNavigate()
  const [tab, setTab] = useState<TabKey>('overview')

  const asset = nodeId ? (model.assets.find((entry) => entry.id === nodeId) ?? null) : null
  const cve = nodeId ? (model.cves.find((entry) => entry.id === nodeId) ?? null) : null
  const isHub = !asset && !cve

  const nodeAlerts = useMemo(() => {
    if (asset) return model.alertsByAsset.get(asset.id) ?? []
    if (cve) return model.alertsByCve.get(cve.id) ?? []
    return model.alerts
  }, [asset, cve, model])

  const activeNodeAlerts = useMemo(() => nodeAlerts.filter((alert) => !alert.suppressed), [nodeAlerts])
  const worstAlert = activeNodeAlerts[0] ?? nodeAlerts[0] ?? null
  const provenanceCve = cve ?? worstAlert?.cve ?? null

  const patch = useLiveFeeds((state) => (provenanceCve ? state.patches[provenanceCve.id] : undefined))
  const syncing = useLiveFeeds((state) => state.syncing)
  const phase = useLiveFeeds((state) => state.phase)
  const meta = useLiveFeeds((state) => state.meta)
  const syncAll = useLiveFeeds((state) => state.syncAll)
  const lastFetch = latestLiveFetch(meta)

  useEffect(() => {
    setTab('overview')
  }, [nodeId])

  const assetRows = useMemo(
    () =>
      model.assets
        .map((entry) => {
          const list = model.alertsByAsset.get(entry.id) ?? []
          const worst = list.find((alert) => !alert.suppressed) ?? list[0] ?? null
          return { asset: entry, worst, count: list.length }
        })
        .sort(
          (a, b) =>
            (b.worst?.score ?? -1) - (a.worst?.score ?? -1) || a.asset.name.localeCompare(b.asset.name),
        ),
    [model],
  )

  const cveRows = useMemo(
    () =>
      model.cves
        .map((entry) => {
          const list = model.alertsByCve.get(entry.id) ?? []
          const worst = list.find((alert) => !alert.suppressed) ?? list[0] ?? null
          return { cve: entry, worst, count: list.length }
        })
        .sort(
          (a, b) =>
            (b.worst?.score ?? -1) - (a.worst?.score ?? -1) || a.cve.id.localeCompare(b.cve.id),
        ),
    [model],
  )

  const labels: Record<TabKey, string> = isHub
    ? { overview: 'Overview', connections: 'Directory', evidence: 'Model', remediation: 'Operations' }
    : cve
      ? { overview: 'Overview', connections: 'Exposure', evidence: 'Evidence', remediation: 'Remediation' }
      : { overview: 'Overview', connections: 'Connections', evidence: 'Evidence', remediation: 'Remediation' }

  const metrics = asset
    ? [
        { label: 'Criticality', value: asset.criticality, tone: asset.criticality.toLowerCase() },
        { label: 'Paths', value: String(nodeAlerts.length) },
        { label: 'Active paths', value: String(activeNodeAlerts.length) },
        { label: 'Worst score', value: worstAlert ? fmtScore(worstAlert.score) : '—' },
        { label: 'Packages', value: String(asset.software.length) },
      ]
    : cve
      ? [
          { label: 'Severity', value: cve.severity, tone: cve.severity.toLowerCase() },
          { label: 'CVSS', value: cve.cvss?.toFixed(1) ?? '—' },
          { label: 'EPSS', value: cve.epss == null ? '—' : fmtPct(cve.epss) },
          { label: 'KEV', value: cve.kev ? 'Listed' : 'Not listed', tone: cve.kev ? 'high' : undefined },
          { label: 'Linked assets', value: String(nodeAlerts.length) },
        ]
      : [
          { label: 'Assets', value: String(model.assets.length) },
          { label: 'CVE records', value: String(model.cves.length) },
          { label: 'Active paths', value: String(model.counts.active) },
          { label: 'Unlinked CVEs', value: String(model.counts.unlinked) },
          { label: 'KEV paths', value: String(model.counts.kev) },
        ]

  const headMeta = asset ? (
    <>
      <span className={cx('badge', asset.criticality.toLowerCase())}>{asset.criticality}</span>
      <span className={cx('badge', asset.internetFacing ? 'high' : 'suppressed')}>
        {asset.internetFacing ? 'Internet-facing' : 'Internal'}
      </span>
      <span className="badge suppressed">{asset.sensitivity} sensitivity</span>
      <span className={cx('badge', lastFetch ? 'real' : 'simulated')}>
        {lastFetch ? 'live feeds' : 'seed snapshot'}
      </span>
    </>
  ) : cve ? (
    <>
      <SeverityBadge level={cve.severity} />
      {cve.kev && <span className="badge high">CISA KEV</span>}
      <span className="badge real">NVD</span>
      <span className="badge real">FIRST EPSS</span>
      <span className={cx('badge', lastFetch ? 'real' : 'simulated')}>
        {lastFetch ? 'live feeds' : 'seed snapshot'}
      </span>
    </>
  ) : (
    <>
      <span className="badge real">live enrichment</span>
      <span className="badge simulated">assets simulated</span>
      <span className={cx('badge', lastFetch ? 'real' : 'simulated')}>
        {lastFetch ? 'live feeds' : 'seed snapshot'}
      </span>
    </>
  )

  const renderOverview = () => {
    if (asset) {
      return (
        <>
          <div className="wb-grid wb-grid-2">
            <Card title="Mission context" sub={`${asset.department} · ${asset.type}`}>
              <p className="wb-copy">{asset.businessFunction}</p>
              <div className="entity-tags">
                <span className="entity-tag">{asset.criticality} criticality</span>
                <span className="entity-tag">{asset.internetFacing ? 'internet-facing' : 'internal only'}</span>
                <span className="entity-tag">{asset.sensitivity} sensitivity</span>
                <span className="entity-tag">{asset.id}</span>
              </div>
            </Card>
            <Card
              title="Risk posture"
              sub={`${activeNodeAlerts.length} active · ${nodeAlerts.length - activeNodeAlerts.length} suppressed`}
            >
              <div className="wb-posture">
                <span
                  className={cx(
                    'wb-score',
                    worstAlert ? (worstAlert.suppressed ? 'suppressed' : worstAlert.level.toLowerCase()) : 'suppressed',
                  )}
                >
                  {worstAlert ? fmtScore(worstAlert.score) : '—'}
                </span>
                <div>
                  <strong>
                    {worstAlert
                      ? worstAlert.suppressed
                        ? 'Suppressed only'
                        : `${worstAlert.level} exposure`
                      : 'No active hazard'}
                  </strong>
                  <p>
                    {worstAlert
                      ? `${worstAlert.cve.id} · ${worstAlert.relevance.replace(/_/g, ' ')}`
                      : 'No correlation path reaches this asset.'}
                  </p>
                </div>
              </div>
              <div className="wb-mini-stats">
                <span><b>{nodeAlerts.length}</b> paths</span>
                <span><b>{asset.software.length}</b> packages</span>
                <span><b>{asset.internetFacing ? 'YES' : 'NO'}</b> internet</span>
              </div>
            </Card>
          </div>

          <Card title="Installed software" sub="Version evidence used by the correlation gate">
            <div className="wb-software">
              {asset.software.map((entry) => (
                <div className="wb-software-row" key={`${entry.vendor}-${entry.product}-${entry.version}`}>
                  <span className="mono wb-soft-vendor">{entry.vendor}</span>
                  <strong>{entry.product}</strong>
                  <span className="mono">{entry.version}</span>
                </div>
              ))}
            </div>
          </Card>

          <Card
            title="Connected hazards"
            sub={`${nodeAlerts.length} correlation paths pinned to ${asset.name}`}
            action={
              <button className="wb-link" onClick={() => setTab('connections')}>
                All connections <ArrowRight size={11} />
              </button>
            }
          >
            {nodeAlerts.length === 0 ? (
              <EmptyNote
                title="No hazard reaches this asset"
                body="No CVE in the demo window maps to this inventory record. The asset still participates in the mesh and can receive a path when the inventory or CVE register changes."
              />
            ) : (
              <div className="wb-node-list">
                {nodeAlerts.slice(0, 5).map((alert) => (
                  <CveRow key={alert.id} alert={alert} onSelect={() => onSelectNode(alert.cve.id)} />
                ))}
              </div>
            )}
          </Card>
        </>
      )
    }

    if (cve) {
      return (
        <>
          <Card title="Record summary" sub={`${cve.vendor} ${cve.product} · ${cve.id}`}>
            <p className="wb-copy">{cve.description}</p>
            <div className="entity-tags">
              <SeverityBadge level={cve.severity} />
              {cve.kev && <span className="entity-tag">CISA KEV</span>}
              {cve.cwe.map((entry) => (
                <span className="entity-tag" key={entry}>
                  {entry}
                </span>
              ))}
              <span className="entity-tag">{cve.vector}</span>
            </div>
          </Card>

          <div className="wb-grid wb-grid-2">
            <Card title="Exploitability" sub="NVD · FIRST EPSS · CISA KEV">
              <div className="wb-kv">
                <div><span>CVSS base</span><b>{cve.cvss?.toFixed(1) ?? '—'}</b></div>
                <div><span>EPSS</span><b>{cve.epss == null ? '—' : fmtPct(cve.epss)}</b></div>
                <div>
                  <span>EPSS percentile</span>
                  <b>{cve.epssPercentile == null ? '—' : `p${Math.round(cve.epssPercentile * 100)}`}</b>
                </div>
                <div>
                  <span>KEV</span>
                  <b>{cve.kev ? `Listed${cve.kevDue ? ` · due ${fmtDate(cve.kevDue)}` : ''}` : 'Not listed'}</b>
                </div>
                <div><span>Published</span><b>{fmtDate(cve.published)}</b></div>
                <div><span>Modified</span><b>{fmtDate(cve.modified)}</b></div>
              </div>
            </Card>
            <Card title="Affected range" sub={`Fix version ${cve.fixVersion}`}>
              <div className="action-box">
                <div className="mono wb-range">{rangeText(cve)}</div>
                <p style={{ marginTop: 6 }}>
                  Installed versions inside this range are matched. Versions outside are suppressed with the reason
                  preserved on the alert.
                </p>
              </div>
              <div className="wb-mini-stats">
                <span><b>{nodeAlerts.length}</b> linked assets</span>
                <span><b>{activeNodeAlerts.length}</b> active</span>
                <span><b>{cve.kev ? 'KEV' : '—'}</b> exploitation</span>
              </div>
            </Card>
          </div>

          <Card
            title="Linked inventory"
            sub={`${nodeAlerts.length} asset${nodeAlerts.length === 1 ? ' carries' : 's carry'} this record`}
            action={
              <button className="wb-link" onClick={() => setTab('connections')}>
                Exposure <ArrowRight size={11} />
              </button>
            }
          >
            {nodeAlerts.length === 0 ? (
              <EmptyNote
                title="No inventory hit"
                body="This CVE has no correlated asset in the simulated estate, so it is drawn as an unlinked shard rather than a hazard on a platform."
              />
            ) : (
              <div className="wb-node-list">
                {nodeAlerts.slice(0, 5).map((alert) => (
                  <AssetRow key={alert.id} alert={alert} onSelect={() => onSelectNode(alert.asset.id)} />
                ))}
              </div>
            )}
          </Card>
        </>
      )
    }

    return (
      <>
        <Card title="What this mesh proves" sub="Simulated estate · live public intelligence">
          <p className="wb-copy">
            AEGIS correlates 16 simulated assets against real NVD records, CISA KEV listings and FIRST EPSS
            probabilities. Every edge is a version-gated candidate; suppressed edges stay visible so the relevance gate
            remains auditable.
          </p>
          <div className="entity-tags">
            <span className="entity-tag">deterministic seed</span>
            <span className="entity-tag">live CVE enrichment</span>
            <span className="entity-tag">relevance gate</span>
            <span className="entity-tag">formula v{FORMULA_VERSION}</span>
          </div>
        </Card>

        <div className="wb-grid wb-grid-2">
          <Card title="Severity mix" sub="Active paths only">
            <div className="wb-bars">
              {LEVELS.map((level) => {
                const count = model.alerts.filter((alert) => !alert.suppressed && alert.level === level).length
                const pct = model.counts.active ? (count / model.counts.active) * 100 : 0
                return (
                  <div className="wb-bar" key={level}>
                    <span className="wb-bar-label">{level}</span>
                    <span className="wb-bar-track">
                      <i className={level.toLowerCase()} style={{ width: `${Math.max(2, pct)}%` }} />
                    </span>
                    <b>{count}</b>
                  </div>
                )
              })}
            </div>
            <div className="wb-mini-stats">
              <span><b>{model.counts.total}</b> edges</span>
              <span><b>{model.counts.suppressed}</b> suppressed</span>
              <span><b>{model.counts.unlinked}</b> unlinked CVEs</span>
            </div>
          </Card>
          <Card title="Feed freshness" sub="Browser-cached live pulls">
            <SourceHealth meta={meta} />
          </Card>
        </div>

        <Card
          title="Highest-priority paths"
          sub="Sorted by relevance-gated score"
          action={
            <button className="wb-link" onClick={() => setTab('connections')}>
              Directory <ArrowRight size={11} />
            </button>
          }
        >
          <div className="wb-node-list">
            {activeNodeAlerts.slice(0, 5).map((alert) => (
              <button key={alert.id} className="wb-node-row" onClick={() => onSelectNode(alert.asset.id)}>
                <span className="wb-node-dot" style={{ background: levelColor(alert.level) }} />
                <span className="wb-node-main">
                  <strong>{alert.asset.name}</strong>
                  <span className="mono">{alert.cve.id} · {alert.cve.product}</span>
                </span>
                <SeverityBadge level={alert.level} />
                <span className={cx('wb-node-score', alert.level.toLowerCase())}>{fmtScore(alert.score)}</span>
                <ArrowRight size={12} />
              </button>
            ))}
          </div>
        </Card>
      </>
    )
  }

  const renderConnections = () => {
    if (asset) {
      return (
        <Card
          title="Correlation paths"
          sub={`${nodeAlerts.length} edges from ${asset.name} into the CVE register`}
          action={<span className="badge simulated">version-gated</span>}
        >
          {nodeAlerts.length === 0 ? (
            <EmptyNote title="No connected CVE" body="No CVE in the demo window maps to this asset's software." />
          ) : (
            <div className="table-wrap wb-table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>CVE node</th>
                    <th>Relevance</th>
                    <th className="col-sm-hide">Level</th>
                    <th className="col-sm-hide">Installed</th>
                    <th className="right">Score</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {nodeAlerts.map((alert) => (
                    <tr key={alert.id} className="clickable" onClick={() => onSelectNode(alert.cve.id)}>
                      <td>
                        <div className="cell-title mono">{alert.cve.id}</div>
                        <div className="cell-sub">{alert.cve.title}</div>
                      </td>
                      <td><RelevanceBadge relevance={alert.relevance} /></td>
                      <td className="col-sm-hide"><SeverityBadge level={alert.level} suppressed={alert.suppressed} /></td>
                      <td className="mono cell-sub col-sm-hide">{alert.version}</td>
                      <td className="right">
                        <span className={cx('score-cell', alert.suppressed ? 'suppressed' : alert.level.toLowerCase())}>
                          {fmtScore(alert.score)}
                        </span>
                      </td>
                      <td className="right"><ArrowRight size={12} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )
    }

    if (cve) {
      return (
        <Card
          title="Asset exposure"
          sub={`${nodeAlerts.length} inventory record${nodeAlerts.length === 1 ? '' : 's'} correlated with ${cve.id}`}
          action={<span className="badge real">live CVE</span>}
        >
          {nodeAlerts.length === 0 ? (
            <EmptyNote
              title="No asset is exposed"
              body="The affected range does not reach any product in the simulated inventory. The record stays in the register for future uploads."
            />
          ) : (
            <div className="table-wrap wb-table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Asset</th>
                    <th className="col-sm-hide">Installed</th>
                    <th>Relevance</th>
                    <th>Level</th>
                    <th className="right">Score</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {nodeAlerts.map((alert) => (
                    <tr key={alert.id} className="clickable" onClick={() => onSelectNode(alert.asset.id)}>
                      <td>
                        <div className="cell-title">{alert.asset.name}</div>
                        <div className="cell-sub">{alert.asset.department}</div>
                      </td>
                      <td className="mono cell-sub col-sm-hide">{alert.version}</td>
                      <td><RelevanceBadge relevance={alert.relevance} /></td>
                      <td><SeverityBadge level={alert.level} suppressed={alert.suppressed} /></td>
                      <td className="right">
                        <span className={cx('score-cell', alert.suppressed ? 'suppressed' : alert.level.toLowerCase())}>
                          {fmtScore(alert.score)}
                        </span>
                      </td>
                      <td className="right"><ArrowRight size={12} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )
    }

    return (
      <div className="wb-grid wb-grid-2">
        <Card title="Asset directory" sub={`${model.assets.length} platforms · sorted by worst score`}>
          <div className="wb-list-scroll">
            {assetRows.map(({ asset: entry, worst, count }) => (
              <button key={entry.id} className="wb-node-row" onClick={() => onSelectNode(entry.id)}>
                <span
                  className="wb-node-dot"
                  style={{ background: worst ? levelColor(worst.level, worst.suppressed) : 'var(--suppressed)' }}
                />
                <span className="wb-node-main">
                  <strong>{entry.name}</strong>
                  <span>{entry.department} · {count} {count === 1 ? 'path' : 'paths'}</span>
                </span>
                <span className={cx('wb-node-score', worst?.level.toLowerCase())}>
                  {worst ? fmtScore(worst.score) : '—'}
                </span>
                <ArrowRight size={12} />
              </button>
            ))}
          </div>
        </Card>

        <Card title="CVE register" sub={`${model.cves.length} records · linked and unlinked`}>
          <div className="wb-list-scroll">
            {cveRows.map(({ cve: entry, worst, count }) => (
              <button key={entry.id} className="wb-node-row" onClick={() => onSelectNode(entry.id)}>
                <span
                  className="wb-node-dot"
                  style={{ background: worst ? levelColor(worst.level, worst.suppressed) : 'var(--critical)' }}
                />
                <span className="wb-node-main">
                  <strong className="mono">{entry.id}</strong>
                  <span>{entry.vendor} {entry.product} · {count ? `${count} ${count === 1 ? 'path' : 'paths'}` : 'unlinked'}</span>
                </span>
                <span className={cx('wb-node-score', worst?.level.toLowerCase())}>
                  {worst ? fmtScore(worst.score) : 'UNLINKED'}
                </span>
                <ArrowRight size={12} />
              </button>
            ))}
          </div>
        </Card>
      </div>
    )
  }

  const renderEvidence = () => {
    if (asset) {
      return (
        <>
          {worstAlert ? (
            <>
              <Card
                title="Score breakdown"
                sub={`${worstAlert.cve.id} · formula v${FORMULA_VERSION}`}
                action={<SeverityBadge level={worstAlert.level} suppressed={worstAlert.suppressed} />}
              >
                <div className="wb-scoreline">
                  <span
                    className={cx(
                      'wb-score',
                      worstAlert.suppressed ? 'suppressed' : worstAlert.level.toLowerCase(),
                    )}
                  >
                    {fmtScore(worstAlert.score)}
                  </span>
                  <div>
                    <strong>{worstAlert.suppressed ? 'Suppressed by relevance' : `${worstAlert.level} risk`}</strong>
                    <p>{worstAlert.summary}</p>
                  </div>
                </div>
                {worstAlert.suppressed ? (
                  <div className="wb-gate">
                    <ShieldAlert size={15} />
                    <div>
                      <strong>Relevance gate applied</strong>
                      <p>
                        {worstAlert.suppressionReason} A CVSS-only queue would have ranked it{' '}
                        {fmtScore(worstAlert.wouldHaveScored ?? 0)}.
                      </p>
                    </div>
                  </div>
                ) : (
                  <ScoreBars alert={worstAlert} />
                )}
                <p className="wb-note">{worstAlert.reasoning}</p>
              </Card>

              <Card title="Version evidence" sub="Installed version against the published affected range">
                <div className="wb-evidence-list">
                  {nodeAlerts.map((alert) => (
                    <div className="wb-evidence-row" key={alert.id}>
                      <div>
                        <strong className="mono">{alert.cve.id}</strong>
                        <span>{alert.cve.product}</span>
                      </div>
                      <span className="mono">{alert.version}</span>
                      <span className="mono">{rangeText(alert.cve)}</span>
                      <RelevanceBadge relevance={alert.relevance} />
                    </div>
                  ))}
                </div>
              </Card>
            </>
          ) : (
            <Card title="Score breakdown" sub="No correlation path">
              <EmptyNote
                title="Nothing to score"
                body="This asset has no CVE candidate in the demo window, so no severity, exploitation or relevance points are applied."
              />
            </Card>
          )}

          <Card title="Live provenance" sub={provenanceCve ? `${provenanceCve.id} · NVD / KEV / EPSS stamps` : 'Feed status'}>
            {provenanceCve ? (
              <LiveProvenance cve={provenanceCve} patch={patch} />
            ) : (
              <SourceHealth meta={meta} />
            )}
            <p className="wb-note">
              Inventory records are simulated. CVE fields are real public data, cached in the browser with a 6 hour KEV
              and EPSS TTL and a 24 hour NVD TTL.
            </p>
          </Card>
        </>
      )
    }

    if (cve) {
      return (
        <>
          {worstAlert ? (
            <Card
              title="Worst affected asset"
              sub={`${worstAlert.asset.name} · formula v${FORMULA_VERSION}`}
              action={<SeverityBadge level={worstAlert.level} suppressed={worstAlert.suppressed} />}
            >
              <div className="wb-scoreline">
                <span className={cx('wb-score', worstAlert.suppressed ? 'suppressed' : worstAlert.level.toLowerCase())}>
                  {fmtScore(worstAlert.score)}
                </span>
                <div>
                  <strong>{worstAlert.suppressed ? 'Suppressed by relevance' : `${worstAlert.level} risk`}</strong>
                  <p>{worstAlert.summary}</p>
                </div>
              </div>
              {worstAlert.suppressed ? (
                <div className="wb-gate">
                  <ShieldAlert size={15} />
                  <div>
                    <strong>Relevance gate applied</strong>
                    <p>{worstAlert.suppressionReason}</p>
                  </div>
                </div>
              ) : (
                <ScoreBars alert={worstAlert} />
              )}
              <p className="wb-note">{worstAlert.reasoning}</p>
            </Card>
          ) : (
            <EmptyNote
              title="No score computed"
              body="The CVE has no inventory hit, so it never enters the alert scoring pipeline."
            />
          )}

          <Card title="Live record" sub="Fields refreshed from public feeds">
            <LiveProvenance cve={cve} patch={patch} />
          </Card>

          <Card title="References" sub={`${cve.refs.length} external advisories`}>
            <div className="wb-refs">
              {cve.refs.map((ref) => (
                <a key={ref.url} href={ref.url} target="_blank" rel="noreferrer" className="link-arrow">
                  <span>{ref.source}</span>
                  <ExternalLink size={11} />
                </a>
              ))}
            </div>
          </Card>
        </>
      )
    }

    return (
      <>
        <Card title="Scoring model" sub={`AEGIS risk formula v${FORMULA_VERSION}`}>
          <div className="wb-weights">
            {(
              [
                ['CVSS severity', WEIGHTS.severity],
                ['EPSS probability', WEIGHTS.epss],
                ['KEV listing', WEIGHTS.kev],
                ['Asset criticality', WEIGHTS.criticality],
                ['Internet exposure', WEIGHTS.exposure],
                ['Version relevance', WEIGHTS.relevance],
              ] as const
            ).map(([label, weight]) => (
              <div className="wb-weight-row" key={label}>
                <span>{label}</span>
                <span className="wb-bar-track">
                  <i style={{ width: `${weight}%` }} />
                </span>
                <b>{weight}</b>
              </div>
            ))}
          </div>
          <p className="wb-note">
            Raw points are summed and capped at 100. NOT_AFFECTED and PRODUCT_ABSENT apply the relevance gate and zero the
            score while preserving the CVSS-only rank for audit.
          </p>
          <div className="wb-mini-stats">
            <span><b>{model.assets.length + model.cves.length + 1}</b> nodes</span>
            <span><b>{model.alerts.length}</b> edges</span>
            <span>
              <b>
                {((2 * model.alerts.length) / (model.assets.length + model.cves.length + 1) / (model.assets.length + model.cves.length)).toFixed(4)}
              </b>{' '}
              density
            </span>
          </div>
        </Card>

        <Card title="Live source health" sub="NVD · CISA KEV · FIRST EPSS">
          <SourceHealth meta={meta} />
          <p className="wb-note">
            {lastFetch ? `Most recent pull ${fmtDateTime(lastFetch)}.` : 'No live pull yet; values come from the seed snapshot.'}
          </p>
        </Card>
      </>
    )
  }

  const renderRemediation = () => {
    if (asset) {
      const suppressed = nodeAlerts.filter((alert) => alert.suppressed)
      return (
        <>
          <Card title="Open actions" sub={`${activeNodeAlerts.length} active path${activeNodeAlerts.length === 1 ? '' : 's'}`}>
            {activeNodeAlerts.length === 0 ? (
              <EmptyNote
                title="No open remediation"
                body="Every correlated path on this asset is suppressed by the relevance gate. Keep the version checks in place and re-run after the next inventory upload."
              />
            ) : (
              <div className="wb-actions-list">
                {activeNodeAlerts.map((alert) => (
                  <RemediationCard
                    key={alert.id}
                    alert={alert}
                    onOpenAlert={() => navigate(`/app/alerts?alert=${alert.id}`)}
                    onOpenCve={() => onSelectNode(alert.cve.id)}
                  />
                ))}
              </div>
            )}
          </Card>

          {suppressed.length > 0 && (
            <Card title="Suppressed paths" sub="No action required · auditable">
              <div className="wb-suppressed-list">
                {suppressed.map((alert) => (
                  <button key={alert.id} className="wb-suppressed-row" onClick={() => onSelectNode(alert.cve.id)}>
                    <span className="mono">{alert.cve.id}</span>
                    <span>{alert.suppressionReason}</span>
                    <ArrowRight size={11} />
                  </button>
                ))}
              </div>
            </Card>
          )}

          <Card title="Handoff">
            <div className="wb-action-buttons">
              <button className="btn btn-ghost btn-sm" onClick={() => navigate('/app/alerts')}>
                Alert center <ArrowRight size={11} />
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => navigate('/app/assets')}>
                Asset inventory
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => navigate('/app/cves')}>
                CVE explorer
              </button>
            </div>
            <div className="wb-footnote">
              <SimulatedBadge />
              <span>Asset correlation is demo context; CVE records and exploitation signals are live public data.</span>
            </div>
          </Card>
        </>
      )
    }

    if (cve) {
      const active = nodeAlerts.filter((alert) => !alert.suppressed)
      return (
        <>
          <Card title="Fix path" sub={`${cve.product} → ${cve.fixVersion}`}>
            <div className="action-box">
              <div className="mono wb-range">{rangeText(cve)}</div>
              <p style={{ marginTop: 6 }}>
                Upgrade every matched installation to <span className="mono">{cve.fixVersion}</span> and restart the
                affected service. Re-run the inventory upload to confirm the version moves outside the affected range.
              </p>
            </div>
            {cve.kev && cve.kevDue && (
              <div className="wb-gate">
                <ShieldAlert size={15} />
                <div>
                  <strong>CISA KEV remediation due {fmtDate(cve.kevDue)}</strong>
                  <p>This record is known-exploited and should be prioritised over CVSS-only findings.</p>
                </div>
              </div>
            )}
          </Card>

          <Card title="Affected assets" sub={`${active.length} active · ${nodeAlerts.length - active.length} suppressed`}>
            {nodeAlerts.length === 0 ? (
              <EmptyNote
                title="No asset requires action"
                body="This CVE has no inventory hit. Keep it in the watch queue and re-correlate after the next asset upload."
              />
            ) : (
              <div className="wb-actions-list">
                {nodeAlerts.map((alert) => (
                  <RemediationCard
                    key={alert.id}
                    alert={alert}
                    onOpenAlert={() => navigate(`/app/alerts?alert=${alert.id}`)}
                    onOpenCve={() => onSelectNode(alert.asset.id)}
                  />
                ))}
              </div>
            )}
          </Card>

          <Card title="Record links">
            <div className="wb-action-buttons">
              <button className="btn btn-ghost btn-sm" onClick={() => navigate('/app/cves')}>
                CVE explorer <ArrowRight size={11} />
              </button>
              {cve.refs[0] && (
                <a className="btn btn-ghost btn-sm" href={cve.refs[0].url} target="_blank" rel="noreferrer">
                  Primary advisory <ExternalLink size={11} />
                </a>
              )}
            </div>
            <div className="wb-footnote">
              <SimulatedBadge />
              <span>Affected ranges are curated demo data; CVSS, EPSS and KEV fields refresh live.</span>
            </div>
          </Card>
        </>
      )
    }

    const top = activeNodeAlerts.slice(0, 3)
    return (
      <>
        <Card title="Operational runbook" sub="From feed refresh to verified remediation">
          <div className="wb-runbook">
            <div className="wb-runbook-step">
              <span>01</span>
              <div>
                <strong>Refresh public intelligence</strong>
                <p>Pull NVD records, CISA KEV listings and FIRST EPSS scores into the browser cache.</p>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => void syncAll({ force: true })}
                  disabled={syncing}
                  aria-busy={syncing}
                >
                  <RefreshCw size={12} className={syncing ? 'spin' : undefined} />
                  {syncing ? `Syncing ${phase ?? ''}` : 'Sync live feeds'}
                </button>
              </div>
            </div>
            <div className="wb-runbook-step">
              <span>02</span>
              <div>
                <strong>Triage critical and KEV paths</strong>
                <p>
                  {model.counts.critical} critical and {model.counts.kev} KEV-backed active paths are in the current
                  window.
                </p>
                <button className="btn btn-ghost btn-sm" onClick={() => navigate('/app/alerts')}>
                  Alert center <ArrowRight size={11} />
                </button>
              </div>
            </div>
            <div className="wb-runbook-step">
              <span>03</span>
              <div>
                <strong>Patch matched assets</strong>
                <p>Upgrade affected packages to the published fix versions, then restart dependent services.</p>
                <button className="btn btn-ghost btn-sm" onClick={() => navigate('/app/assets')}>
                  Asset inventory <ArrowRight size={11} />
                </button>
              </div>
            </div>
            <div className="wb-runbook-step">
              <span>04</span>
              <div>
                <strong>Verify inventory telemetry</strong>
                <p>Re-upload the estate inventory so the mesh recomputes relevance and closes stale edges.</p>
                <button className="btn btn-ghost btn-sm" onClick={() => navigate('/app/uploads')}>
                  Upload inventory <ArrowRight size={11} />
                </button>
              </div>
            </div>
          </div>
        </Card>

        <Card title="Priority shortlist" sub="Top active paths in the current window">
          <div className="wb-node-list">
            {top.map((alert) => (
              <button key={alert.id} className="wb-node-row" onClick={() => onSelectNode(alert.asset.id)}>
                <span className="wb-node-dot" style={{ background: levelColor(alert.level) }} />
                <span className="wb-node-main">
                  <strong>{alert.asset.name}</strong>
                  <span className="mono">{alert.cve.id} · target {alert.cve.fixVersion}</span>
                </span>
                <SeverityBadge level={alert.level} />
                <span className={cx('wb-node-score', alert.level.toLowerCase())}>{fmtScore(alert.score)}</span>
                <ArrowRight size={12} />
              </button>
            ))}
          </div>
        </Card>
      </>
    )
  }

  return (
    <Drawer open={Boolean(nodeId)} onClose={onClose} label="Node analysis workbench" wide>
      <DrawerHead
        overline={
          asset ? `ASSET NODE · ${asset.id}` : cve ? `CVE RECORD · ${cve.id}` : 'CORRELATION CORE'
        }
        title={asset ? asset.name : cve ? cve.title : 'AEGIS exposure mesh'}
        onClose={onClose}
        meta={<span className="wb-head-meta">{headMeta}</span>}
      />

      <div className="drawer-body wb-body">
        <div className="wb-livebar">
          <span className={cx('wb-live-dot', lastFetch && 'on')} />
          <span className="wb-live-text">
            {syncing
              ? `Syncing ${phase ?? 'live feeds'}`
              : lastFetch
                ? `Live feeds pulled ${timeAgo(lastFetch)}`
                : 'Seed snapshot · no live pull yet'}
          </span>
          <span className="wb-live-sources">NVD · CISA KEV · FIRST EPSS</span>
          <button
            className="btn btn-ghost btn-sm wb-sync"
            onClick={() => void syncAll({ force: true })}
            disabled={syncing}
            aria-busy={syncing}
          >
            <RefreshCw size={12} className={syncing ? 'spin' : undefined} />
            {syncing ? 'Syncing' : 'Sync'}
          </button>
        </div>

        <div className="wb-metrics">
          {metrics.map((metric) => (
            <div className="wb-metric" key={metric.label}>
              <span>{metric.label}</span>
              <b className={metric.tone ? `tone-${metric.tone}` : undefined}>{metric.value}</b>
            </div>
          ))}
        </div>

        <div className="wb-tabs" role="tablist" aria-label="Node analysis sections">
          {TABS.map((key) => (
            <button
              key={key}
              role="tab"
              aria-selected={tab === key}
              className={cx('wb-tab', tab === key && 'on')}
              onClick={() => setTab(key)}
            >
              {labels[key]}
            </button>
          ))}
        </div>

        <div className="wb-panel" role="tabpanel" aria-label={labels[tab]}>
          {tab === 'overview' && renderOverview()}
          {tab === 'connections' && renderConnections()}
          {tab === 'evidence' && renderEvidence()}
          {tab === 'remediation' && renderRemediation()}
        </div>
      </div>
    </Drawer>
  )
}

function Card({
  title,
  sub,
  action,
  children,
}: {
  title: string
  sub?: string
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="wb-card">
      <header className="wb-card-head">
        <div>
          <h3>{title}</h3>
          {sub && <p>{sub}</p>}
        </div>
        {action}
      </header>
      <div className="wb-card-body">{children}</div>
    </section>
  )
}

function EmptyNote({ title, body }: { title: string; body: string }) {
  return (
    <div className="wb-empty">
      <Info size={15} />
      <div>
        <strong>{title}</strong>
        <p>{body}</p>
      </div>
    </div>
  )
}

function CveRow({ alert, onSelect }: { alert: Alert; onSelect: () => void }) {
  return (
    <button className="wb-node-row" onClick={onSelect}>
      <span className="wb-node-dot" style={{ background: levelColor(alert.level, alert.suppressed) }} />
      <span className="wb-node-main">
        <strong className="mono">{alert.cve.id}</strong>
        <span>{alert.cve.title}</span>
      </span>
      <SeverityBadge level={alert.level} suppressed={alert.suppressed} />
      <span className={cx('wb-node-score', alert.level.toLowerCase())}>{fmtScore(alert.score)}</span>
      <ArrowRight size={12} />
    </button>
  )
}

function AssetRow({ alert, onSelect }: { alert: Alert; onSelect: () => void }) {
  return (
    <button className="wb-node-row" onClick={onSelect}>
      <span className="wb-node-dot" style={{ background: levelColor(alert.level, alert.suppressed) }} />
      <span className="wb-node-main">
        <strong>{alert.asset.name}</strong>
        <span>{alert.asset.department} · installed {alert.version}</span>
      </span>
      <SeverityBadge level={alert.level} suppressed={alert.suppressed} />
      <span className={cx('wb-node-score', alert.level.toLowerCase())}>{fmtScore(alert.score)}</span>
      <ArrowRight size={12} />
    </button>
  )
}

function ScoreBars({ alert }: { alert: Alert }) {
  const b = alert.breakdown
  const factors = [
    { label: 'CVSS severity', value: b.severity_points, max: WEIGHTS.severity },
    { label: 'EPSS probability', value: b.exploit_points, max: WEIGHTS.epss },
    { label: 'KEV listing', value: b.kev_points, max: WEIGHTS.kev },
    { label: 'Asset criticality', value: b.criticality_points, max: WEIGHTS.criticality },
    { label: 'Internet exposure', value: b.exposure_points, max: WEIGHTS.exposure },
    { label: 'Version relevance', value: b.relevance_points, max: WEIGHTS.relevance },
  ]
  return (
    <div className="wb-bars wb-bars-detail">
      {factors.map((factor) => {
        const pct = factor.max ? Math.min(100, (factor.value / factor.max) * 100) : 0
        return (
          <div className="wb-bar" key={factor.label}>
            <span className="wb-bar-label">{factor.label}</span>
            <span className="wb-bar-track">
              <i className={factor.label === 'KEV listing' ? 'high' : undefined} style={{ width: `${Math.max(1.5, pct)}%` }} />
            </span>
            <b>
              {factor.value.toFixed(1)}
              <span className="wb-bar-max"> / {factor.max}</span>
            </b>
          </div>
        )
      })}
    </div>
  )
}

function LiveProvenance({ cve, patch }: { cve: Cve; patch?: LiveCvePatch }) {
  const rows = [
    {
      label: 'NVD record',
      at: patch?.nvdAt,
      detail: patch?.nvdAt
        ? `CVSS ${cve.cvss?.toFixed(1) ?? '—'} · ${cve.cwe.length} CWE · ${cve.refs.length} refs`
        : 'seed snapshot',
    },
    {
      label: 'FIRST EPSS',
      at: patch?.epssAt,
      detail:
        patch?.epss == null
          ? 'seed snapshot'
          : `EPSS ${fmtPct(patch.epss)} · p${Math.round((patch.epssPercentile ?? 0) * 100)}`,
    },
    {
      label: 'CISA KEV',
      at: patch?.kevAt,
      detail:
        patch?.kev == null
          ? 'seed snapshot'
          : patch.kev
            ? `listed${cve.kevDue ? ` · due ${fmtDate(cve.kevDue)}` : ''}`
            : 'not listed',
    },
  ]
  return (
    <div className="provenance-list">
      {rows.map((row) => (
        <div className="provenance-row" key={row.label}>
          <span className={row.at ? 'check' : 'dim'}>{row.at ? '✓' : '·'}</span>
          <span>{row.label}</span>
          <span className="time">
            {row.detail}
            {row.at ? ` · ${timeAgo(row.at)}` : ''}
          </span>
        </div>
      ))}
    </div>
  )
}

function SourceHealth({ meta }: { meta: Partial<Record<LiveSource, LiveSourceMeta>> }) {
  return (
    <div className="provenance-list">
      {SOURCES.map((source) => {
        const entry = meta[source]
        return (
          <div className="provenance-row" key={source}>
            <span className={entry?.status === 'ok' ? 'check' : entry?.status === 'error' ? 'miss' : 'dim'}>
              {entry?.status === 'ok' ? '✓' : entry?.status === 'error' ? '!' : '·'}
            </span>
            <span>{source}</span>
            <span className="time">
              {entry
                ? `${entry.status === 'ok' ? `${entry.records} recs` : entry.error ?? 'error'} · ${timeAgo(entry.fetchedAt)}`
                : 'seed snapshot'}
            </span>
          </div>
        )
      })}
    </div>
  )
}

function RemediationCard({
  alert,
  onOpenAlert,
  onOpenCve,
}: {
  alert: Alert
  onOpenAlert: () => void
  onOpenCve: () => void
}) {
  return (
    <div
      className={cx('wb-action', alert.suppressed && 'is-suppressed')}
      style={{ '--action-tone': levelColor(alert.level, alert.suppressed) } as CSSProperties}
    >
      <div className="wb-action-head">
        <span className="wb-action-dot" />
        <strong>{alert.action}</strong>
        <SeverityBadge level={alert.level} suppressed={alert.suppressed} />
      </div>
      <p className="wb-note">{alert.summary}</p>
      <div className="wb-action-meta">
        <span className="mono">{alert.cve.id}</span>
        <span className="mono">installed {alert.version}</span>
        <span className="mono">target {alert.cve.fixVersion}</span>
        {alert.cve.kev && alert.cve.kevDue && (
          <span className="badge high">KEV due {fmtDate(alert.cve.kevDue)}</span>
        )}
      </div>
      <div className="wb-action-buttons">
        <button className="btn btn-ghost btn-sm" onClick={onOpenAlert}>
          Open alert <ArrowRight size={11} />
        </button>
        <button className="btn btn-ghost btn-sm" onClick={onOpenCve}>
          Inspect node
        </button>
      </div>
    </div>
  )
}
