import { useMemo, useState } from 'react'
import { PageHeader, Panel } from '../../components/Panel'
import { Drawer, DrawerHead } from '../../components/Drawer'
import { StatsPanel } from '../../components/StatsPanel'
import { EmptyState } from '../../components/EmptyState'
import { BoardDial, BoardRiskRow, BoardStat, levelColor } from '../../components/BoardDetail'
import { SeverityBadge } from '../../components/Badges'
import {
  ArrowRight,
  Bug,
  ExternalLink,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  X,
} from '../../components/Icons'
import { DEMO_NOW } from '../../data/seed'
import { useFilters } from '../../lib/store'
import { cx, fmtDate, fmtDateTime, fmtPct, fmtScore, timeAgo } from '../../lib/format'
import { median, quantile } from '../../lib/stats'
import { LEVEL_COLORS } from '../../lib/colors'
import { latestLiveFetch, useLiveCves, useLiveFeeds } from '../../lib/liveFeeds'
import { useLiveActiveAlerts, useLiveAlerts } from '../../lib/liveData'
import { CveOrbit, CveSpectrum, cvssBin } from './cve/CveVisuals'
import { CveWorkspace } from './cve/CveWorkspace'
import { stageLabel, useCveWorkflow } from './cve/useCveWorkflow'
import type { Alert, Cve } from '../../lib/types'
import './cves.css'

export const rangeLabel = (cve: Cve) => {
  const r = cve.range
  if (!r.startIncluding && !r.startExcluding && !r.endIncluding && !r.endExcluding) return 'not published'
  const start = r.startIncluding ? `≥ ${r.startIncluding}` : r.startExcluding ? `> ${r.startExcluding}` : '*'
  const end = r.endIncluding ? `≤ ${r.endIncluding}` : r.endExcluding ? `< ${r.endExcluding}` : '*'
  return `${start} → ${end}`
}

const BANDS = ['ALL', 'CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const
type Band = (typeof BANDS)[number]

const SORTS = [
  { key: 'cvss', label: 'CVSS' },
  { key: 'epss', label: 'EPSS' },
  { key: 'new', label: 'Newest' },
] as const
type SortKey = (typeof SORTS)[number]['key']

const BAND_LABEL: Record<Band, string> = {
  ALL: 'All severities',
  CRITICAL: 'Critical',
  HIGH: 'High',
  MEDIUM: 'Medium',
  LOW: 'Low',
}

const alertsByCve = (list: Alert[]) =>
  list.reduce<Map<string, Alert[]>>((map, alert) => {
    const related = map.get(alert.cve.id)
    if (related) related.push(alert)
    else map.set(alert.cve.id, [alert])
    return map
  }, new Map())

type Exposure = {
  key: 'matched' | 'unverified' | 'reviewed' | 'none'
  label: string
  tone: string
  detail: string
}

function exposureFor(cve: Cve, map: Map<string, Alert[]>): Exposure {
  const related = map.get(cve.id) ?? []
  const live = related.filter((alert) => !alert.suppressed)
  const matched = live.filter((alert) => alert.relevance === 'MATCHED')
  if (matched.length > 0) {
    return {
      key: 'matched',
      label: matched.length === 1 ? 'Matched' : `${matched.length} assets`,
      tone: 'high',
      detail: matched[0].asset.name + (matched.length > 1 ? ` +${matched.length - 1}` : ''),
    }
  }
  const unknown = live.filter((alert) => alert.relevance === 'VERSION_UNKNOWN')
  if (unknown.length > 0) {
    return { key: 'unverified', label: 'Unverified', tone: 'amber', detail: unknown[0].asset.name }
  }
  if (related.length > 0) {
    return {
      key: 'reviewed',
      label: 'Reviewed out',
      tone: 'muted',
      detail: related.length === 1 ? related[0].asset.name : `${related.length} assets`,
    }
  }
  return { key: 'none', label: 'No exposure', tone: 'muted', detail: 'No asset correlated' }
}

function primaryRisk(cve: Cve, exposure: Exposure) {
  if (exposure.key === 'matched' && cve.kev) {
    return { label: 'Actively exploited', tone: 'critical', detail: `${exposure.detail} · in KEV` }
  }
  if (exposure.key === 'matched') {
    return { label: 'Exposed asset', tone: 'high', detail: exposure.detail }
  }
  if (exposure.key === 'unverified') {
    return { label: 'Version unverified', tone: 'amber', detail: exposure.detail }
  }
  if (cve.kev) {
    return { label: 'Known exploited', tone: 'amber', detail: 'CISA KEV · no asset match' }
  }
  if ((cve.epss ?? 0) >= 0.5) {
    return { label: 'High exploit odds', tone: 'high', detail: `${fmtPct(cve.epss ?? 0)} 30-day EPSS` }
  }
  if ((cve.cvss ?? 0) >= 9) {
    return { label: 'Severe impact', tone: 'critical', detail: 'CVSS ≥ 9 · no exposure' }
  }
  return { label: 'Monitor', tone: 'muted', detail: 'No exposure signal' }
}

const epssColor = (epss: number) =>
  epss >= 0.9
    ? 'var(--critical)'
    : epss >= 0.5
      ? 'var(--high)'
      : epss >= 0.1
        ? 'var(--medium)'
        : 'var(--low)'

const scoreColor = (cvss: number) =>
  cvss >= 9 ? 'var(--critical)' : cvss >= 7 ? 'var(--high)' : cvss >= 4 ? 'var(--medium)' : 'var(--low)'

export default function Cves() {
  const query = useFilters((s) => s.query)
  const setQuery = useFilters((s) => s.setQuery)
  const [kevOnly, setKevOnly] = useState(false)
  const [band, setBand] = useState<Band>('ALL')
  const [bin, setBin] = useState<number | null>(null)
  const [sort, setSort] = useState<SortKey>('cvss')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const liveCves = useLiveCves()
  const alerts = useLiveAlerts()
  const activeAlerts = useLiveActiveAlerts()
  const byCve = useMemo(() => alertsByCve(alerts), [alerts])
  const syncing = useLiveFeeds((s) => s.syncing)
  const phase = useLiveFeeds((s) => s.phase)
  const liveMeta = useLiveFeeds((s) => s.meta)
  const syncAll = useLiveFeeds((s) => s.syncAll)
  const lastFetch = latestLiveFetch(liveMeta)
  const selected = selectedId ? (liveCves.find((c) => c.id === selectedId) ?? null) : null
  const workspaceCve = workspaceId ? (liveCves.find((c) => c.id === workspaceId) ?? null) : null
  const flows = useCveWorkflow((s) => s.flows)
  const flowCount = Object.keys(flows).length

  const chartEntries = useMemo(
    () =>
      liveCves
        .filter((c) => (kevOnly ? c.kev : true))
        .filter((c) => (band === 'ALL' ? true : c.severity === band)),
    [kevOnly, band, liveCves],
  )

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return chartEntries
      .filter((c) => (bin === null ? true : cvssBin(c) === bin))
      .filter((c) =>
        q ? `${c.id} ${c.title} ${c.vendor} ${c.product} ${c.cwe.join(' ')}`.toLowerCase().includes(q) : true,
      )
      .map((c) => {
        const exposure = exposureFor(c, byCve)
        return { cve: c, exposure, risk: primaryRisk(c, exposure) }
      })
      .sort((a, b) => {
        if (sort === 'new') {
          return new Date(b.cve.published).getTime() - new Date(a.cve.published).getTime()
        }
        if (sort === 'epss') {
          return (b.cve.epss ?? 0) - (a.cve.epss ?? 0) || (b.cve.cvss ?? 0) - (a.cve.cvss ?? 0)
        }
        return (b.cve.cvss ?? 0) - (a.cve.cvss ?? 0) || (b.cve.epss ?? 0) - (a.cve.epss ?? 0)
      })
  }, [chartEntries, bin, query, sort, byCve])

  const kevCount = liveCves.filter((c) => c.kev).length
  const medianEpss = median(liveCves.map((c) => c.epss ?? 0))
  const peakCvss = Math.max(...liveCves.map((c) => c.cvss ?? 0))
  const withRanges = liveCves.filter((c) => rangeLabel(c) !== 'not published').length
  const epssBuckets = Array.from({ length: 14 }, (_, i) =>
    liveCves.filter((c) => Math.min(13, Math.floor((c.epss ?? 0) * 14)) === i).length,
  )
  const epssPeak = Math.max(1, ...epssBuckets)

  const bandScope = kevOnly ? liveCves.filter((c) => c.kev) : liveCves
  const bandCounts = BANDS.reduce<Record<Band, number>>(
    (acc, next) => {
      acc[next] = next === 'ALL' ? bandScope.length : bandScope.filter((c) => c.severity === next).length
      return acc
    },
    { ALL: 0, CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 },
  )

  const chooseBand = (next: Band) => {
    setBand(next)
    setBin(null)
  }

  const chooseBin = (next: number | null) => {
    setBin(next)
    if (next !== null) setBand('ALL')
  }

  return (
    <div className="page cve-lab">
      <PageHeader
        eyebrow="COMPONENT 07 · CVE EXPLORER"
        title="Real IDs, readable ranges"
        description="Every CVE below exists in NVD. Components 1–15 consume these records; the affected ranges are written the way an engineer needs to read them."
        actions={
          <div className="cve-head-tools">
            <span className={cx('cve-snapshot', lastFetch && 'is-live')}>
              <i />
              {syncing
                ? `syncing ${phase ?? ''}`
                : lastFetch
                  ? `live · pulled ${timeAgo(lastFetch)}`
                  : `snapshot ${DEMO_NOW.toISOString().slice(0, 10)}`}
            </span>
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => void syncAll({ force: true })}
              disabled={syncing}
              aria-busy={syncing}
            >
              <RefreshCw size={13} className={syncing ? 'spin' : undefined} />
              {syncing ? 'Syncing' : 'Sync live feeds'}
            </button>
            <a className="btn btn-ghost btn-sm" href="https://nvd.nist.gov/" target="_blank" rel="noreferrer">
              NVD <ExternalLink size={12} />
            </a>
          </div>
        }
      />

      <div className="cve-signals" role="group" aria-label="CVE corpus summary">
        <div className="cve-signal tone-teal">
          <div className="cve-signal-top">
            <span className="cve-signal-label">CVE corpus</span>
            <span className="cve-signal-meta">NVD</span>
          </div>
          <div className="cve-signal-value">
            {liveCves.length}
            <small>ids</small>
          </div>
          <div className="cve-signal-note">Real public identifiers</div>
          <div className="cve-signal-viz">
            <div className="cve-dotfield" aria-hidden="true">
              {liveCves.map((c) => (
                <i
                  key={c.id}
                  style={{ background: LEVEL_COLORS[c.severity], boxShadow: `0 0 6px ${LEVEL_COLORS[c.severity]}66` }}
                />
              ))}
            </div>
          </div>
        </div>

        <div className="cve-signal tone-amber is-accent is-kev">
          <div className="cve-signal-top">
            <span className="cve-signal-label">Known exploited</span>
            <span className="cve-signal-meta">KEV</span>
          </div>
          <div className="cve-signal-value">
            {kevCount}
            <small>/ {liveCves.length}</small>
          </div>
          <div className="cve-signal-note">CISA KEV listings</div>
          <div className="cve-signal-viz">
            <div className="cve-dotfield" aria-hidden="true">
              {liveCves.map((c) => (
                <i key={c.id} className={c.kev ? 'on' : undefined} />
              ))}
            </div>
          </div>
        </div>

        <div className="cve-signal tone-critical is-accent">
          <div className="cve-signal-top">
            <span className="cve-signal-label">Peak CVSS</span>
            <span className="cve-signal-meta">MAX</span>
          </div>
          <div className="cve-signal-value">{peakCvss.toFixed(1)}</div>
          <div className="cve-signal-note">Apache Log4Shell</div>
          <div className="cve-signal-viz">
            <div className="cve-score-rail" aria-hidden="true">
              <i style={{ left: `${(peakCvss / 10) * 100}%` }} />
            </div>
          </div>
        </div>

        <div className="cve-signal tone-teal is-accent">
          <div className="cve-signal-top">
            <span className="cve-signal-label">Median EPSS</span>
            <span className="cve-signal-meta">30D</span>
          </div>
          <div className="cve-signal-value">{fmtPct(medianEpss)}</div>
          <div className="cve-signal-note">Exploitation likelihood</div>
          <div className="cve-signal-viz">
            <div className="cve-epss-bars" aria-hidden="true">
              {epssBuckets.map((count, i) => (
                <i key={i} style={{ height: `${Math.max(8, (count / epssPeak) * 100)}%` }} />
              ))}
            </div>
          </div>
        </div>

        <div className="cve-signal tone-low is-accent">
          <div className="cve-signal-top">
            <span className="cve-signal-label">Affected versions</span>
            <span className="cve-signal-meta">published ranges</span>
          </div>
          <div className="cve-signal-value">
            {withRanges}
            <small>/ {liveCves.length}</small>
          </div>
          <div className="cve-signal-note">Affected ranges published</div>
          <div className="cve-signal-viz">
            <div className="cve-range-track" aria-hidden="true">
              <i style={{ width: `${(withRanges / liveCves.length) * 100}%` }} />
            </div>
          </div>
        </div>
      </div>

      <div className="dash-grid cve-deck">
        <CveOrbit
          className="col-7"
          entries={liveCves}
          band={band}
          kevOnly={kevOnly}
          bin={bin}
          onPick={(cve) => setSelectedId(cve.id)}
        />
        <CveSpectrum className="col-5" entries={chartEntries} activeBin={bin} onBin={chooseBin} />

        <Panel
          className="col-12 cve-register"
          title="CVE register"
          sub={`${rows.length} of ${liveCves.length} records · ${flowCount} in response · exposure derived from correlated alerts`}
          action={
            <span className={lastFetch ? 'badge real' : 'badge simulated'}>
              {lastFetch ? 'Live pull · cached' : 'Seed snapshot'}
            </span>
          }
          noPad
          spotlight
        >
          <div className="ops-tabs" role="tablist" aria-label="Filter CVEs by severity">
            {BANDS.map((next) => (
              <button
                key={next}
                role="tab"
                aria-selected={band === next}
                className={cx('ops-tab', band === next && 'on')}
                onClick={() => chooseBand(next)}
              >
                {BAND_LABEL[next]}
                <span className="ops-tab-count">{bandCounts[next]}</span>
              </button>
            ))}
          </div>
          <div className="ops-toolbar">
            <div className="topbar-search">
              <Search size={13} />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search CVE, product, CWE…"
                aria-label="Search CVEs"
              />
            </div>
            <span className="ops-toolbar-label">Sort</span>
            <div className="seg" role="group" aria-label="Sort CVE records">
              {SORTS.map((option) => (
                <button
                  key={option.key}
                  className={sort === option.key ? 'on' : undefined}
                  aria-pressed={sort === option.key}
                  onClick={() => setSort(option.key)}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <button
              className="chip"
              onClick={() => setKevOnly((v) => !v)}
              aria-pressed={kevOnly}
              style={kevOnly ? { color: 'var(--amber)', borderColor: 'rgba(227,164,85,.4)' } : undefined}
            >
              <ShieldAlert size={12} /> KEV only
            </button>
            {bin !== null && (
              <span className="cve-filter-chip">
                CVSS band {bin}
                {bin === 9 ? '+' : `–${bin + 1}`}
                <button type="button" onClick={() => setBin(null)} aria-label="Clear CVSS band filter">
                  <X size={11} />
                </button>
              </span>
            )}
            <div className="ops-toolbar-spacer" />
            <span className="ops-result">
              {rows.length} of {liveCves.length}
            </span>
          </div>
          {rows.length === 0 ? (
            <EmptyState title="No CVE matches" hint="Clear the severity band, the KEV filter, or the search." />
          ) : (
            <div className="ops-table-wrap">
              <table className="ops-table cve">
                <thead>
                  <tr>
                    <th>CVE</th>
                    <th>Affected range</th>
                    <th>Exposure</th>
                    <th>EPSS</th>
                    <th>CVSS</th>
                    <th>Primary risk</th>
                    <th className="right">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ cve: c, exposure, risk }) => {
                    const flow = flows[c.id]
                    return (
                    <tr
                      key={c.id}
                      className={selected?.id === c.id ? 'is-selected' : undefined}
                      onClick={() => setSelectedId(c.id)}
                    >
                      <td className="ops-cell-main">
                        <div className="ops-ident">
                          <span className={cx('ops-tile', c.severity.toLowerCase())}>
                            <Bug size={15} strokeWidth={1.7} />
                          </span>
                          <div className="ops-ident-copy">
                            <div className="ops-meta-row">
                              <span className="ops-id">{c.id}</span>
                              <span className={cx('ops-pill', c.severity.toLowerCase())}>
                                <i />
                                {c.severity}
                              </span>
                              {c.kev && <span className="ops-tag amber">KEV</span>}
                            </div>
                            <span className="ops-name" title={c.title}>
                              {c.title}
                            </span>
                            <span className="ops-sub">
                              {c.vendor} {c.product} · published {fmtDate(c.published)}
                            </span>
                          </div>
                        </div>
                      </td>
                      <td>
                        <span className="ops-code" title={rangeLabel(c)}>
                          {rangeLabel(c)}
                        </span>
                        <span className="ops-sub mono" style={{ marginTop: 4 }}>
                          fix {c.fixVersion}
                        </span>
                      </td>
                      <td>
                        <span className={cx('ops-pill', exposure.tone)}>
                          <i />
                          {exposure.label}
                        </span>
                        <span className="ops-sub" style={{ marginTop: 4 }}>
                          {exposure.detail}
                        </span>
                      </td>
                      <td>
                        <div className="ops-metric">
                          <span className="ops-meter">
                            <i
                              style={{
                                width: `${(c.epss ?? 0) * 100}%`,
                                background: epssColor(c.epss ?? 0),
                              }}
                            />
                          </span>
                          <span className="ops-metric-value strong">
                            {c.epss == null ? '—' : fmtPct(c.epss)}
                          </span>
                        </div>
                        <span className="ops-sub mono" style={{ marginTop: 3 }}>
                          30-day prob
                        </span>
                      </td>
                      <td>
                        <div className="ops-score">
                          <b style={{ color: scoreColor(c.cvss ?? 0) }}>{c.cvss?.toFixed(1) ?? '—'}</b>
                          <span className="ops-meter">
                            <i
                              style={{
                                width: `${((c.cvss ?? 0) / 10) * 100}%`,
                                background: scoreColor(c.cvss ?? 0),
                              }}
                            />
                          </span>
                        </div>
                        <span className="ops-sub mono" style={{ marginTop: 3 }}>
                          {c.cwe[0] ?? 'no CWE'}
                        </span>
                      </td>
                      <td>
                        <span className={cx('ops-pill', risk.tone)}>
                          <i />
                          {risk.label}
                        </span>
                        <span className="ops-sub" style={{ marginTop: 4 }}>
                          {risk.detail}
                        </span>
                      </td>
                      <td className="right">
                        <div className="cve-register-action">
                          {flow && (
                            <span
                              className={cx('cve-flow-chip', `s-${flow.stage}`)}
                              title={`Response in progress · ${flow.stage} · ${flow.owner ?? 'unassigned'}`}
                            >
                              <i />
                              {stageLabel(flow.stage)}
                            </span>
                          )}
                          <button
                            className="ops-action"
                            onClick={(event) => {
                              event.stopPropagation()
                              setSelectedId(c.id)
                            }}
                            aria-label={`Open CVE workspace for ${c.id}`}
                          >
                            Review <ArrowRight size={11} />
                          </button>
                        </div>
                      </td>
                    </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
          <div className="ops-table-foot">
            <span className="inline-flex">
              <ShieldCheck size={11} /> {alerts.length} correlation candidates reference these records;{' '}
              {activeAlerts.length} survive relevance.
            </span>
            <span className="mono">
              {lastFetch ? `live pull ${fmtDateTime(lastFetch)} · cached in browser` : `snapshot ${DEMO_NOW.toISOString().slice(0, 10)}`}
            </span>
          </div>
        </Panel>

        <StatsPanel
          className="col-12 cve-stats"
          stats={[
            {
              name: 'KEV proportion',
              value: `${((kevCount / liveCves.length) * 100).toFixed(1)}%`,
              formula: 'KEV-listed ÷ CVEs',
              n: liveCves.length,
            },
            {
              name: 'Median CVSS',
              value: median(liveCves.map((c) => c.cvss ?? 0)).toFixed(1),
              formula: 'median base score',
              n: liveCves.length,
            },
            {
              name: 'p90 EPSS',
              value: fmtPct(quantile(liveCves.map((c) => c.epss ?? 0), 0.9)),
              formula: '90th percentile EPSS',
              n: liveCves.length,
            },
            {
              name: 'Mean EPSS',
              value: fmtPct(liveCves.reduce((a, b) => a + (b.epss ?? 0), 0) / liveCves.length),
              formula: 'arithmetic mean',
              n: liveCves.length,
            },
            {
              name: 'CVEs with version ranges',
              value: String(liveCves.filter((c) => rangeLabel(c) !== 'not published').length),
              formula: 'range present in demo data',
              n: liveCves.length,
            },
          ]}
        />
      </div>

      <Drawer open={Boolean(selected)} onClose={() => setSelectedId(null)} label={selected ? selected.id : 'CVE'} board>
        {selected && (
          <CveDetail
            cve={selected}
            onClose={() => setSelectedId(null)}
            onOpenWorkspace={() => setWorkspaceId(selected.id)}
          />
        )}
      </Drawer>

      <Drawer
        wide
        open={Boolean(workspaceCve)}
        onClose={() => setWorkspaceId(null)}
        label={workspaceCve ? `${workspaceCve.id} workspace` : 'CVE workspace'}
      >
        {workspaceCve && (
          <CveWorkspace
            key={workspaceCve.id}
            cve={workspaceCve}
            onClose={() => setWorkspaceId(null)}
            onOpenCve={setWorkspaceId}
          />
        )}
      </Drawer>
    </div>
  )
}

const CWE_NAMES: Record<string, string> = {
  'CWE-20': 'Improper input validation',
  'CWE-77': 'Command injection',
  'CWE-78': 'Operating system command injection',
  'CWE-89': 'SQL injection',
  'CWE-94': 'Code injection',
  'CWE-119': 'Buffer overflow',
  'CWE-269': 'Improper privilege management',
  'CWE-287': 'Improper authentication',
  'CWE-330': 'Weak randomness',
  'CWE-364': 'Race condition',
  'CWE-400': 'Resource exhaustion',
  'CWE-502': 'Unsafe deserialization',
  'CWE-506': 'Embedded malicious code',
  'CWE-674': 'Uncontrolled recursion',
  'CWE-787': 'Out-of-bounds write',
  'CWE-918': 'Server-side request forgery',
}

const plainRange = (cve: Cve) => {
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
  if (!low && !high) return 'The vendor has not published a version range.'
  return `Versions ${[low, high].filter(Boolean).join(' ')} are affected.`
}

const fixCopy = (cve: Cve) =>
  /update/i.test(cve.fixVersion) ? `Apply ${cve.fixVersion}` : `Upgrade to ${cve.fixVersion}`

function CveDetail({
  cve,
  onClose,
  onOpenWorkspace,
}: {
  cve: Cve
  onClose: () => void
  onOpenWorkspace: () => void
}) {
  const alerts = useLiveAlerts()
  const related = alerts
    .filter((a) => a.cve.id === cve.id)
    .sort((a, b) => Number(a.suppressed) - Number(b.suppressed) || b.score - a.score)
  const patch = useLiveFeeds((s) => s.patches[cve.id])
  const exposure = exposureFor(cve, alertsByCve(alerts))
  const active = related.filter((a) => !a.suppressed)
  const matched = active.filter((a) => a.relevance === 'MATCHED')
  const unverified = active.filter((a) => a.relevance === 'VERSION_UNKNOWN')
  const cvss = cve.cvss
  const epss = cve.epss
  const summary = matched.length
    ? `${matched.length} system${matched.length === 1 ? ' is' : 's are'} running an affected version.`
    : unverified.length
      ? `${unverified.length} system${unverified.length === 1 ? '' : 's'} run ${cve.product}, but the installed version needs checking.`
      : 'No system in the demo inventory currently matches this CVE.'

  return (
    <>
      <DrawerHead
        overline={`${cve.id} · ${cve.vendor} ${cve.product}`}
        title={cve.title}
        onClose={onClose}
        meta={
          <span className="inline-flex" style={{ flexWrap: 'wrap', gap: 6 }}>
            <SeverityBadge level={cve.severity} />
            {cve.kev && <span className="badge critical">Known exploited</span>}
            <span className={matched.length > 0 ? 'badge high' : 'badge medium'}>
              {matched.length > 0 ? `${matched.length} affected ${matched.length === 1 ? 'asset' : 'assets'}` : exposure.label}
            </span>
          </span>
        }
      />
      <div className="drawer-body">
        <div className="drawer-section">
          <div className="bd-hero bd-hero-cve">
            <div className="bd-cve-dials">
              <BoardDial
                value={cvss ?? 0}
                max={10}
                color={cvss == null ? 'var(--bd-muted)' : 'var(--bd-crit)'}
                display={cvss == null ? '—' : cvss.toFixed(1)}
                label="Severity"
                sub="CVSS · 0–10"
                size={136}
                stroke={9}
              />
              <BoardDial
                value={(epss ?? 0) * 100}
                max={100}
                color="var(--bd-orange)"
                display={epss == null ? '—' : fmtPct(epss)}
                label="Exploit chance"
                sub="next 30 days"
                size={136}
                stroke={9}
              />
            </div>
            <div className="bd-hero-copy">
              <span className="bd-kicker">{cve.kev ? 'Known exploited · act now' : `${cve.severity} severity`}</span>
              <h3>{cve.title}</h3>
              <p>{summary}</p>
              <div className="bd-chips">
                <span className="bd-chip is-live">{fixCopy(cve)}</span>
                <span className="bd-chip">Published {fmtDate(cve.published)}</span>
              </div>
            </div>
          </div>
          <div className="bd-stats" style={{ marginTop: 12 }}>
            <BoardStat label="Affected assets" value={matched.length} sub="installed version in range" tone="orange" />
            <BoardStat label="Need a version check" value={unverified.length} sub="software found, version unknown" />
            <BoardStat
              label="Known exploited"
              value={cve.kev ? 'Yes' : 'No'}
              sub={cve.kev ? 'in the CISA catalog' : 'no confirmed exploitation'}
              tone={cve.kev ? 'orange' : undefined}
            />
          </div>
        </div>

        <div className="drawer-section">
          <h3>What happened</h3>
          <p>{cve.description}</p>
        </div>

        <div className="drawer-section">
          <h3>Exposure in your estate</h3>
          {related.length === 0 ? (
            <div className="bd-empty">No system in the demo inventory matches this CVE right now.</div>
          ) : (
            <div className="bd-risks">
              {related.map((a) => (
                <BoardRiskRow
                  key={a.id}
                  title={a.asset.name}
                  badge={<SeverityBadge level={a.level} suppressed={a.suppressed} />}
                  value={a.suppressed ? 0 : a.score}
                  display={a.suppressed ? 'Held' : fmtScore(a.score)}
                  color={a.suppressed ? 'var(--bd-slate)' : levelColor[a.level]}
                  muted={a.suppressed}
                  meta={
                    <>
                      <span>{a.version === 'unknown' ? 'Version not recorded' : `Installed ${a.version}`}</span>
                      <span>
                        {a.suppressed
                          ? 'Held back by the version check'
                          : a.relevance === 'MATCHED'
                            ? 'Version in range'
                            : 'Waiting for a version check'}
                      </span>
                    </>
                  }
                />
              ))}
            </div>
          )}
        </div>

        <div className="drawer-section">
          <h3>How to fix it</h3>
          <div className="bd-action">
            <span className="bd-kicker">Recommended fix</span>
            <strong>{fixCopy(cve)}</strong>
            <p>{plainRange(cve)}</p>
            {cve.kev && cve.kevDue && <span className="bd-due">CISA remediation deadline · {fmtDate(cve.kevDue)}</span>}
            <button type="button" className="bd-btn" style={{ marginTop: 12 }} onClick={onOpenWorkspace}>
              Open response workspace <ArrowRight size={12} />
            </button>
          </div>
        </div>

        <div className="drawer-section">
          <h3>Vulnerability type</h3>
          <div className="bd-chips">
            {cve.cwe.map((code) => (
              <span className="bd-chip" key={code}>
                {CWE_NAMES[code] ?? 'Classified weakness'}
              </span>
            ))}
          </div>
        </div>

        <div className="drawer-section">
          <h3>References</h3>
          <div className="bd-links">
            {cve.refs.map((r) => (
              <a key={r.url} href={r.url} target="_blank" rel="noreferrer" className="bd-link">
                <span>{r.source} record</span>
                <ExternalLink size={12} />
              </a>
            ))}
          </div>
        </div>

        <div className="drawer-section">
          <h3>Where this data comes from</h3>
          <div className="bd-chips">
            <span className="bd-chip">NVD {patch?.nvdAt ? `· updated ${timeAgo(patch.nvdAt)}` : '· demo snapshot'}</span>
            <span className="bd-chip">FIRST EPSS {patch?.epssAt ? `· updated ${timeAgo(patch.epssAt)}` : '· demo snapshot'}</span>
            <span className="bd-chip">CISA KEV {patch?.kevAt ? `· updated ${timeAgo(patch.kevAt)}` : '· demo snapshot'}</span>
          </div>
          <p style={{ marginTop: 10, fontSize: 11, color: 'var(--bd-muted)' }}>
            The vulnerability record is real. Asset matching uses the demo inventory.
          </p>
        </div>
      </div>
      <div className="drawer-foot">
        <span>Published {fmtDate(cve.published)}</span>
        <span>Last updated {fmtDate(cve.modified)}</span>
      </div>
    </>
  )
}
