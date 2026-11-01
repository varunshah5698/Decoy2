import { useMemo, useState } from 'react'
import { PageHeader, Panel } from '../../components/Panel'
import { Drawer, DrawerHead } from '../../components/Drawer'
import { StatsPanel } from '../../components/StatsPanel'
import { SeverityBadge, SimulatedBadge, UploadBadge } from '../../components/Badges'
import { EmptyState } from '../../components/EmptyState'
import {
  ArrowRight,
  Bug,
  Check,
  ExternalLink,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  X,
} from '../../components/Icons'
import { useEstate } from '../../lib/estate'
import { useFilters } from '../../lib/store'
import { cx, fmtDate, fmtDateTime, fmtPct, fmtScore, timeAgo } from '../../lib/format'
import { median, quantile } from '../../lib/stats'
import { LEVEL_COLORS } from '../../lib/colors'
import { latestLiveFetch, useLiveFeeds } from '../../lib/liveFeeds'
import { CveOrbit, CveSpectrum, cvssBin } from './cve/CveVisuals'
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

const alertsByCve = (rows: Alert[]) =>
  rows.reduce<Map<string, Alert[]>>((map, alert) => {
    const list = map.get(alert.cve.id)
    if (list) list.push(alert)
    else map.set(alert.cve.id, [alert])
    return map
  }, new Map())

type Exposure = {
  key: 'matched' | 'unverified' | 'reviewed' | 'none'
  label: string
  tone: string
  detail: string
}

function exposureFor(cve: Cve, byCve: Map<string, Alert[]>): Exposure {
  const related = byCve.get(cve.id) ?? []
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
  const estate = useEstate()
  const liveCves = estate.cves
  const alertRows = estate.alerts
  const byCve = useMemo(() => alertsByCve(alertRows), [alertRows])
  const syncing = useLiveFeeds((s) => s.syncing)
  const phase = useLiveFeeds((s) => s.phase)
  const liveMeta = useLiveFeeds((s) => s.meta)
  const syncAll = useLiveFeeds((s) => s.syncAll)
  const lastFetch = latestLiveFetch(liveMeta)
  const selected = selectedId ? (liveCves.find((c) => c.id === selectedId) ?? null) : null

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
                  : `snapshot ${estate.nowIso.slice(0, 10)}`}
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
            <span className="cve-signal-label">CPE ranges</span>
            <span className="cve-signal-meta">CVE → CPE</span>
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
          sub={`${rows.length} of ${liveCves.length} records · exposure derived from correlated alerts`}
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
                  {rows.map(({ cve: c, exposure, risk }) => (
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
                        <button
                          className="ops-action"
                          onClick={(event) => {
                            event.stopPropagation()
                            setSelectedId(c.id)
                          }}
                          aria-label={`Review ${c.id}`}
                        >
                          Review <ArrowRight size={11} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="ops-table-foot">
            <span className="inline-flex">
              <ShieldCheck size={11} /> {estate.alerts.length} correlation candidates reference these records;{' '}
              {estate.activeAlerts.length} survive relevance.
            </span>
            <span className="mono">
              {lastFetch ? `live pull ${fmtDateTime(lastFetch)} · cached in browser` : `snapshot ${estate.nowIso.slice(0, 10)}`}
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
              name: 'CVEs with CPE ranges',
              value: String(liveCves.filter((c) => rangeLabel(c) !== 'not published').length),
              formula: 'range present in the bundled CPE corpus',
              n: liveCves.length,
            },
          ]}
        />
      </div>

      <Drawer open={Boolean(selected)} onClose={() => setSelectedId(null)} label={selected ? selected.id : 'CVE'}>
        {selected && <CveDetail cve={selected} onClose={() => setSelectedId(null)} />}
      </Drawer>
    </div>
  )
}

function CveDetail({ cve, onClose }: { cve: Cve; onClose: () => void }) {
  const estate = useEstate()
  const related = estate.alerts.filter((a) => a.cve.id === cve.id)
  const patch = useLiveFeeds((s) => s.patches[cve.id])
  const exposure = exposureFor(cve, useMemo(() => alertsByCve(estate.alerts), [estate.alerts]))
  const risk = primaryRisk(cve, exposure)
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
      detail: patch?.kev == null ? 'seed snapshot' : patch.kev ? `listed · due ${cve.kevDue ? fmtDate(cve.kevDue) : '—'}` : 'not listed',
    },
  ]
  return (
    <>
      <DrawerHead
        overline={`${cve.id} · ${cve.vendor.toUpperCase()} ${cve.product.toUpperCase()}`}
        title={cve.title}
        onClose={onClose}
        meta={
          <span className="inline-flex" style={{ flexWrap: 'wrap', gap: 8 }}>
            <SeverityBadge level={cve.severity} />
            {cve.kev && <span className="badge high">CISA KEV</span>}
            <span className={cx('ops-pill', risk.tone)}>
              <i />
              {risk.label}
            </span>
            <span className={cx('ops-pill', exposure.tone)}>
              <i />
              {exposure.label}
            </span>
          </span>
        }
      />
      <div className="drawer-body">
        <div className="drawer-section">
          <p style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.7 }}>{cve.description}</p>
          <div className="drawer-meta">
            <span>CVSS {cve.cvss?.toFixed(1) ?? '—'}</span>
            <span>EPSS {cve.epss == null ? '—' : fmtPct(cve.epss)}</span>
            <span>{cve.kev ? 'in KEV' : 'not in KEV'}</span>
          </div>
        </div>

        <div className="drawer-section">
          <h3>Exposure and priority</h3>
          <div className="action-box">
            <div className="inline-flex" style={{ flexWrap: 'wrap', gap: 8 }}>
              <span className={cx('ops-pill', risk.tone)}>
                <i />
                {risk.label}
              </span>
              <span className={cx('ops-pill', exposure.tone)}>
                <i />
                {exposure.label}
              </span>
            </div>
            <p style={{ fontSize: 11.5, color: 'var(--text-dim)', marginTop: 8, lineHeight: 1.6 }}>
              {risk.detail}. Exposure is derived from the {estate.coverage.hasUploads ? 'uploaded estate' : 'demo'}{' '}
              inventory through the relevance gate, not from a live scan.
            </p>
          </div>
        </div>

        <div className="drawer-section">
          <h3>Affected range</h3>
          <div className="action-box">
            <div className="mono" style={{ fontSize: 13, color: 'var(--teal)' }}>
              {rangeLabel(cve)}
            </div>
            <p style={{ fontSize: 11.5, color: 'var(--text-dim)', marginTop: 6 }}>
              Installed versions inside this range are MATCHED. Versions outside are suppressed with the reason
              kept on the alert. Fix version on this record: <span className="mono">{cve.fixVersion}</span>.
            </p>
          </div>
        </div>

        <div className="drawer-section">
          <h3>Weaknesses</h3>
          <div className="entity-tags">
            {cve.cwe.map((c) => (
              <span className="entity-tag" key={c}>
                {c}
              </span>
            ))}
            <span className="entity-tag">{cve.vector}</span>
          </div>
        </div>

        <div className="drawer-section">
          <h3>Correlated alerts</h3>
          {related.length === 0 ? (
            <EmptyState title="No alert from this CVE" hint="No asset in the current estate meets the relevance gate." />
          ) : (
            <div style={{ display: 'grid', gap: 8 }}>
              {related.map((a) => (
                <div key={a.id} className="action-box">
                  <div className="inline-flex" style={{ justifyContent: 'space-between', width: '100%' }}>
                    <strong style={{ fontSize: 12 }}>{a.asset.name}</strong>
                    <span className="inline-flex">
                      <SeverityBadge level={a.level} suppressed={a.suppressed} />
                      <span className="mono" style={{ marginLeft: 8 }}>{fmtScore(a.score)}</span>
                    </span>
                  </div>
                  <div className="mono" style={{ marginTop: 5, fontSize: 8.5 }}>
                    {a.relevance} · installed {a.version}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="drawer-section">
          <h3>References</h3>
          <div style={{ display: 'grid', gap: 6 }}>
            {cve.refs.map((r) => (
              <a
                key={r.url}
                href={r.url}
                target="_blank"
                rel="noreferrer"
                className="link-arrow"
                style={{ fontSize: 11.5, justifyContent: 'space-between' }}
              >
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.source}</span>
                <ExternalLink size={11} />
              </a>
            ))}
          </div>
        </div>

        <div className="drawer-section">
          <h3>Live pull</h3>
          <div className="provenance-list">
            {liveRows.map((row) => (
              <div className="provenance-row" key={row.label}>
                <span className={row.at ? 'check' : 'dim'}>{row.at ? <Check size={12} /> : '·'}</span>
                <span>{row.label}</span>
                <span className="time">
                  {row.detail}
                  {row.at ? ` · ${timeAgo(row.at)}` : ''}
                </span>
              </div>
            ))}
          </div>
          {!liveRows.some((row) => row.at) && (
            <p className="dim" style={{ fontSize: 11, marginTop: 8 }}>
              No live pull for this record yet; values come from the bundled NVD/KEV/EPSS corpus. Use “Sync live feeds”.
            </p>
          )}
        </div>

        <div className="drawer-section">
          <h3>Timestamps</h3>
          <div className="provenance-list">
            <div className="provenance-row">
              <Check size={12} className="check" />
              <span>Published</span>
              <span className="time">{fmtDate(cve.published)}</span>
            </div>
            <div className="provenance-row">
              <Check size={12} className="check" />
              <span>Last modified</span>
              <span className="time">{fmtDate(cve.modified)}</span>
            </div>
            <div className="provenance-row">
              <Check size={12} className="check" />
              <span>EPSS snapshot</span>
              <span className="time">{patch?.epssAt ? fmtDate(patch.epssAt) : fmtDate(estate.nowIso)}</span>
            </div>
          </div>
        </div>

        <div className="drawer-section">
          {related.some((a) => a.asset.source === 'USER UPLOAD') ? (
            <UploadBadge />
          ) : (
            <SimulatedBadge />
          )}{''}
          <span className="dim" style={{ fontSize: 11 }}>
            Asset correlation uses {estate.coverage.hasUploads ? 'your uploaded inventory plus' : 'the'} demo context; the CVE record is real.
          </span>
        </div>
      </div>
    </>
  )
}
