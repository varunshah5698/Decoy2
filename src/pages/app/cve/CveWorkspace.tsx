import { useState, type CSSProperties, type ReactNode } from 'react'
import {
  ArrowRight,
  Check,
  ExternalLink,
  FileSearch,
  Network,
  SlidersHorizontal,
  X,
} from '../../../components/Icons'
import { SeverityBadge, SimulatedBadge } from '../../../components/Badges'
import { LEVEL_COLORS, SUPPRESSED } from '../../../lib/colors'
import { rangeText, useCorrelationModel } from '../../../lib/correlation'
import { useLiveFeeds } from '../../../lib/liveFeeds'
import { clamp, cx, fmtDate, fmtDateTime, fmtPct, fmtScore, timeAgo } from '../../../lib/format'
import { CveExposure } from './CveExposure'
import { CveResponse } from './CveResponse'
import { stageLabel, useCveWorkflow, type Priority } from './useCveWorkflow'
import type { Alert, Cve, RiskLevel } from '../../../lib/types'

type Tab = 'exposure' | 'response' | 'record'

const defaultPriority = (cve: Cve, related: Alert[]): Priority => {
  const active = related.filter((alert) => !alert.suppressed)
  const matched = active.some((alert) => alert.relevance === 'MATCHED')
  if (matched && (cve.severity === 'CRITICAL' || cve.kev)) return 'P1'
  if (cve.severity === 'CRITICAL' || cve.kev || (matched && cve.severity === 'HIGH')) return 'P2'
  if (cve.severity === 'HIGH' || active.length > 0) return 'P3'
  return 'P4'
}

function ExposureDial({
  score,
  level,
  state,
}: {
  score: number | null
  level: RiskLevel
  state: 'active' | 'suppressed' | 'none'
}) {
  const color = state === 'active' ? LEVEL_COLORS[level] : SUPPRESSED
  const radius = 27
  const circumference = 2 * Math.PI * radius
  const ratio = state === 'active' && score != null ? clamp(score, 0, 100) / 100 : 0
  return (
    <div className="cve-ws-dial" style={{ '--dial': color } as CSSProperties}>
      <svg viewBox="0 0 72 72" aria-hidden="true">
        <circle cx="36" cy="36" r={radius} fill="none" stroke="rgba(255,255,255,.12)" strokeWidth="4" />
        <circle
          cx="36"
          cy="36"
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={`${circumference * ratio} ${circumference}`}
          transform="rotate(-90 36 36)"
        />
      </svg>
      <div className="cve-ws-dial-copy">
        <b>{state === 'active' && score != null ? Math.round(score) : '–'}</b>
        <span>{state === 'active' ? 'Exposure' : state === 'suppressed' ? 'Reviewed out' : 'No asset'}</span>
      </div>
    </div>
  )
}

export function CveWorkspace({
  cve,
  onOpenCve,
  onClose,
}: {
  cve: Cve
  onOpenCve: (cveId: string) => void
  onClose: () => void
}) {
  const model = useCorrelationModel()
  const related = model.alertsByCve.get(cve.id) ?? []
  const flow = useCveWorkflow((s) => s.flows[cve.id])
  const [tab, setTab] = useState<Tab>('exposure')
  const [copiedId, setCopiedId] = useState(false)

  const priority = flow?.priority ?? defaultPriority(cve, related)
  const best = related.reduce<Alert | null>((winner, alert) => {
    if (alert.suppressed) return winner
    return !winner || alert.score > winner.score ? alert : winner
  }, null)
  const dialState = best ? 'active' : related.length > 0 ? 'suppressed' : 'none'
  const sevColor = LEVEL_COLORS[cve.severity]

  const tabs: { key: Tab; label: string; icon: ReactNode; tag?: string }[] = [
    {
      key: 'exposure',
      label: 'Exposure graph',
      icon: <Network size={13} />,
      tag: related.length > 0 ? String(related.length) : undefined,
    },
    {
      key: 'response',
      label: 'Response',
      icon: <SlidersHorizontal size={13} />,
      tag: flow ? stageLabel(flow.stage) : 'New',
    },
    { key: 'record', label: 'CVE record', icon: <FileSearch size={13} /> },
  ]

  const copyId = async () => {
    try {
      await navigator.clipboard.writeText(cve.id)
      setCopiedId(true)
      window.setTimeout(() => setCopiedId(false), 2000)
    } catch {
      setCopiedId(false)
    }
  }

  return (
    <>
      <header className="cve-ws-head" style={{ '--sev': sevColor } as CSSProperties}>
        <div className="cve-ws-head-main">
          <div className="cve-ws-head-top">
            <span className="cve-ws-overline">
              {cve.id} · {cve.vendor} {cve.product}
            </span>
            <button
              type="button"
              className={cx('cve-ws-stagechip', !flow && 'is-idle')}
              onClick={() => setTab('response')}
            >
              <i />
              {flow ? `In response · ${stageLabel(flow.stage)}` : 'Not started'}
            </button>
          </div>
          <h2 id="cve-ws-title">{cve.title}</h2>
          <div className="cve-ws-head-meta">
            <SeverityBadge level={cve.severity} />
            {cve.kev && <span className="badge high">CISA KEV</span>}
            <span className="cve-ws-headstat">
              <span>CVSS</span>
              <b>{cve.cvss?.toFixed(1) ?? '—'}</b>
            </span>
            <span className="cve-ws-headstat">
              <span>EPSS</span>
              <b>{cve.epss == null ? '—' : fmtPct(cve.epss)}</b>
            </span>
            {best && (
              <span className="cve-ws-headstat">
                <span>Exposure</span>
                <b>{fmtScore(best.score)}</b>
              </span>
            )}
          </div>
        </div>
        <div className="cve-ws-head-side">
          <ExposureDial score={best?.score ?? null} level={best?.level ?? cve.severity} state={dialState} />
        </div>
        <button type="button" className="cve-ws-close" onClick={onClose} aria-label="Close CVE workspace">
          <X size={16} />
        </button>
      </header>

      <nav className="cve-ws-tabs" role="tablist" aria-label="CVE workspace views">
        {tabs.map((entry) => (
          <button
            key={entry.key}
            type="button"
            role="tab"
            aria-selected={tab === entry.key}
            className={cx('cve-ws-tab', tab === entry.key && 'on')}
            onClick={() => setTab(entry.key)}
          >
            {entry.icon}
            {entry.label}
            {entry.tag && <span className="cve-ws-tab-tag">{entry.tag}</span>}
          </button>
        ))}
      </nav>

      <div className="cve-ws-body" role="tabpanel" aria-label={`${cve.id} ${tab}`}>
        {tab === 'exposure' && (
          <CveExposure
            cve={cve}
            alerts={related}
            alertsByAsset={model.alertsByAsset}
            cves={model.cves}
            onOpenCve={onOpenCve}
            onOpenResponse={() => setTab('response')}
          />
        )}
        {tab === 'response' && <CveResponse cve={cve} alerts={related} priority={priority} />}
        {tab === 'record' && <RecordTab cve={cve} />}
      </div>

      <footer className="cve-ws-foot">
        <div className="cve-ws-foot-state">
          <i className={flow ? 'on' : undefined} />
          {flow
            ? `${flow.priority} · ${stageLabel(flow.stage)} · ${flow.owner ?? 'unassigned'}`
            : `Workflow not started · suggested ${priority}`}
        </div>
        <div className="cve-ws-foot-actions">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void copyId()}>
            {copiedId ? 'Copied' : 'Copy CVE ID'}
          </button>
          {tab === 'response' ? (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setTab('exposure')}>
              <Network size={12} /> Exposure graph
            </button>
          ) : (
            <button type="button" className="btn btn-primary btn-sm" onClick={() => setTab('response')}>
              {flow ? 'Open response' : 'Start response'} <ArrowRight size={12} />
            </button>
          )}
        </div>
      </footer>
    </>
  )
}

function RecordFacts({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="cve-ws-facts">
      {items.map((item) => (
        <div key={item.label}>
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  )
}

function RecordTab({ cve }: { cve: Cve }) {
  const patch = useLiveFeeds((s) => s.patches[cve.id])
  const liveRows = [
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
            ? `listed · due ${cve.kevDue ? fmtDate(cve.kevDue) : '—'}`
            : 'not listed',
    },
  ]

  return (
    <div className="cve-ws-record">
      <section className="cve-ws-panel">
        <header className="cve-ws-panel-head">
          <span className="mono">Description</span>
          <span className="cve-ws-panel-meta">
            {cve.vendor} {cve.product}
          </span>
        </header>
        <div className="cve-ws-panel-body">
          <p className="cve-ws-record-desc">{cve.description}</p>
          <div className="cve-ws-tags">
            {cve.cwe.map((weakness) => (
              <span className="entity-tag" key={weakness}>
                {weakness}
              </span>
            ))}
          </div>
          <code className="cve-ws-vector">{cve.vector}</code>
        </div>
      </section>

      <div className="cve-ws-record-grid">
        <section className="cve-ws-panel">
          <header className="cve-ws-panel-head">
            <span className="mono">Identifiers</span>
          </header>
          <div className="cve-ws-panel-body">
            <RecordFacts
              items={[
                { label: 'Published', value: fmtDate(cve.published) },
                { label: 'Last modified', value: fmtDate(cve.modified) },
                { label: 'Vendor', value: cve.vendor },
                { label: 'Product', value: cve.product },
              ]}
            />
          </div>
        </section>
        <section className="cve-ws-panel">
          <header className="cve-ws-panel-head">
            <span className="mono">Affected surface</span>
          </header>
          <div className="cve-ws-panel-body">
            <RecordFacts
              items={[
                { label: 'CPE range', value: <span className="mono">{rangeText(cve)}</span> },
                { label: 'Fix version', value: <span className="mono">{cve.fixVersion}</span> },
                { label: 'CVSS', value: <span className="mono">{cve.cvss?.toFixed(1) ?? '—'}</span> },
                {
                  label: 'EPSS',
                  value: (
                    <span className="mono">
                      {cve.epss == null ? '—' : fmtPct(cve.epss)}
                      {cve.epssPercentile != null ? ` · p${Math.round(cve.epssPercentile * 100)}` : ''}
                    </span>
                  ),
                },
              ]}
            />
          </div>
        </section>
      </div>

      <div className="cve-ws-record-grid">
        <section className="cve-ws-panel">
          <header className="cve-ws-panel-head">
            <span className="mono">References</span>
            <span className="cve-ws-panel-meta">{cve.refs.length}</span>
          </header>
          <div className="cve-ws-refs">
            {cve.refs.map((ref) => (
              <a key={ref.url} href={ref.url} target="_blank" rel="noreferrer" title={ref.url}>
                <span>{ref.source}</span>
                <ExternalLink size={11} />
              </a>
            ))}
          </div>
        </section>
        <section className="cve-ws-panel">
          <header className="cve-ws-panel-head">
            <span className="mono">Live pull</span>
            <span className="cve-ws-panel-meta">{liveRows.some((row) => row.at) ? 'patched' : 'seed'}</span>
          </header>
          <div className="cve-ws-provenance">
            {liveRows.map((row) => (
              <div className="cve-ws-prov" key={row.label}>
                <span className={cx('cve-ws-prov-dot', row.at && 'ok')}>
                  {row.at ? <Check size={9} /> : <i />}
                </span>
                <span className="cve-ws-prov-label">{row.label}</span>
                <span className="cve-ws-prov-detail">
                  {row.detail}
                  {row.at ? ` · ${timeAgo(row.at)}` : ''}
                </span>
              </div>
            ))}
          </div>
          {!liveRows.some((row) => row.at) && (
            <p className="cve-ws-hint cve-ws-prov-note">
              No live pull for this record yet. Use “Sync live feeds” on the CVE Explorer page.
            </p>
          )}
        </section>
      </div>

      <div className="cve-ws-record-note">
        <SimulatedBadge />
        <span>Asset correlation is demo context; the CVE record itself is real.</span>
        <span className="cve-ws-record-stamp mono">modified {fmtDateTime(cve.modified)}</span>
      </div>
    </div>
  )
}
