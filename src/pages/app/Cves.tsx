import { useMemo, useState } from 'react'
import { Chart, axisStyle } from '../../components/Chart'
import { PageHeader, Panel } from '../../components/Panel'
import { Drawer, DrawerHead } from '../../components/Drawer'
import { StatsPanel } from '../../components/StatsPanel'
import { SeverityBadge, SourceBadge, SimulatedBadge } from '../../components/Badges'
import { EmptyState } from '../../components/EmptyState'
import { ExternalLink, RefreshCw, Search, ShieldAlert } from '../../components/Icons'
import { activeAlerts, alerts, DEMO_NOW } from '../../data/seed'
import { useFilters, useTheme } from '../../lib/store'
import { fmtDate, fmtDateTime, fmtPct, fmtScore, timeAgo } from '../../lib/format'
import { median, quantile } from '../../lib/stats'
import { AMBER, LEVEL_COLORS, TEAL, hexA } from '../../lib/colors'
import { latestLiveFetch, useLiveCves, useLiveFeeds } from '../../lib/liveFeeds'
import type { Cve, RiskLevel } from '../../lib/types'

export const rangeLabel = (cve: Cve) => {
  const r = cve.range
  if (!r.startIncluding && !r.startExcluding && !r.endIncluding && !r.endExcluding) return 'not published'
  const start = r.startIncluding ? `≥ ${r.startIncluding}` : r.startExcluding ? `> ${r.startExcluding}` : '*'
  const end = r.endIncluding ? `≤ ${r.endIncluding}` : r.endExcluding ? `< ${r.endExcluding}` : '*'
  return `${start} → ${end}`
}

export default function Cves() {
  const theme = useTheme((s) => s.theme)
  const query = useFilters((s) => s.query)
  const setQuery = useFilters((s) => s.setQuery)
  const [kevOnly, setKevOnly] = useState(false)
  const [band, setBand] = useState<'ALL' | RiskLevel>('ALL')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const liveCves = useLiveCves()
  const syncing = useLiveFeeds((s) => s.syncing)
  const phase = useLiveFeeds((s) => s.phase)
  const liveMeta = useLiveFeeds((s) => s.meta)
  const syncAll = useLiveFeeds((s) => s.syncAll)
  const lastFetch = latestLiveFetch(liveMeta)
  const selected = selectedId ? (liveCves.find((c) => c.id === selectedId) ?? null) : null

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return liveCves
      .filter((c) => (kevOnly ? c.kev : true))
      .filter((c) => (band === 'ALL' ? true : c.severity === band))
      .filter((c) =>
        q ? `${c.id} ${c.title} ${c.vendor} ${c.product} ${c.cwe.join(' ')}`.toLowerCase().includes(q) : true,
      )
      .sort((a, b) => (b.cvss ?? 0) - (a.cvss ?? 0) || (b.epss ?? 0) - (a.epss ?? 0))
  }, [kevOnly, band, query, liveCves])

  const scatterOption = useMemo(() => {
    const ax = axisStyle(theme)
    return {
      grid: { left: 40, right: 18, top: 26, bottom: 42 },
      xAxis: { type: 'value', min: 0, max: 10, name: 'CVSS base score', nameLocation: 'middle', nameGap: 25, ...ax },
      yAxis: { type: 'value', min: 0, max: 1, name: 'EPSS', nameGap: 30, ...ax, axisLabel: { ...ax.axisLabel, formatter: (v: number) => `${Math.round(v * 100)}%` } },
      tooltip: {
        formatter: (p: any) =>
          `<strong>${p.data[3]}</strong><br/>CVSS ${p.data[0]} · EPSS ${(p.data[1] * 100).toFixed(1)}%<br/>${p.data[4]}`,
      },
      series: [
        {
          type: 'scatter',
          data: liveCves.map((c) => [c.cvss ?? 0, c.epss ?? 0, c.kev ? 16 : 9, c.id, c.title]),
          symbolSize: (v: any) => v[2],
          itemStyle: {
            color: (p: any) => (p.data[3] && liveCves.find((c) => c.id === p.data[3])?.kev ? hexA(AMBER, 0.82) : hexA(TEAL, 0.6)),
            borderColor: 'rgba(5,8,14,0.6)',
            borderWidth: 1,
          },
          emphasis: { scale: 1.3 },
        },
      ],
    }
  }, [theme, liveCves])

  const histOption = useMemo(() => {
    const bins = Array.from({ length: 10 }, (_, i) => i)
    const data = bins.map((b) => liveCves.filter((c) => c.cvss != null && Math.floor(c.cvss) === b).length)
    const ax = axisStyle(theme)
    return {
      grid: { left: 32, right: 12, top: 18, bottom: 26 },
      xAxis: { type: 'category', data: bins.map((b) => `${b}–${b + 1}`), ...ax, axisLabel: { ...ax.axisLabel, interval: 0, fontSize: 7.5 } },
      yAxis: { type: 'value', ...ax, minInterval: 1 },
      tooltip: { trigger: 'axis' },
      series: [
        {
          type: 'bar',
          barWidth: '64%',
          data: data.map((v, i) => ({
            value: v,
            itemStyle: {
              color: i >= 9 ? LEVEL_COLORS.CRITICAL : i >= 7 ? LEVEL_COLORS.HIGH : i >= 4 ? LEVEL_COLORS.MEDIUM : LEVEL_COLORS.LOW,
              borderRadius: [3, 3, 0, 0],
              opacity: 0.82,
            },
          })),
        },
      ],
    }
  }, [theme, liveCves])

  const kevCount = liveCves.filter((c) => c.kev).length
  const medianEpss = median(liveCves.map((c) => c.epss ?? 0))

  return (
    <div className="page">
      <PageHeader
        eyebrow="COMPONENT 07 · CVE EXPLORER"
        title="Real IDs, readable ranges"
        description="Every CVE below exists in NVD. NVD, CISA KEV and FIRST EPSS are pulled live in your browser and cached locally; the version ranges stay curated so they read the way an engineer needs them."
        actions={
          <div className="inline-flex" style={{ gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span className="mono" style={{ fontSize: 9, color: lastFetch ? 'var(--teal)' : 'var(--text-mute)' }}>
              {syncing ? `syncing ${phase ?? ''}` : lastFetch ? `live · pulled ${timeAgo(lastFetch)}` : 'seed snapshot'}
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

      <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(5, minmax(0,1fr))' }}>
        <div className="kpi">
          <div className="kpi-label">CVEs in demo window</div>
          <div className="kpi-value">{liveCves.length}</div>
          <div className="kpi-delta">real public identifiers</div>
        </div>
        <div className="kpi amber-tone">
          <div className="kpi-label">In CISA KEV</div>
          <div className="kpi-value">{kevCount}</div>
          <div className="kpi-delta">known exploited</div>
        </div>
        <div className="kpi critical-tone">
          <div className="kpi-label">Max CVSS</div>
          <div className="kpi-value">{Math.max(...liveCves.map((c) => c.cvss ?? 0)).toFixed(1)}</div>
          <div className="kpi-delta">Log4Shell</div>
        </div>
        <div className="kpi teal-tone">
          <div className="kpi-label">Median EPSS</div>
          <div className="kpi-value">{fmtPct(medianEpss)}</div>
          <div className="kpi-delta">30-day exploitation probability</div>
        </div>
        <div className="kpi high-tone">
          <div className="kpi-label">With affected ranges</div>
          <div className="kpi-value">{liveCves.filter((c) => rangeLabel(c) !== 'not published').length}</div>
          <div className="kpi-delta">CPE-derived boundaries</div>
        </div>
      </div>

      <div className="dash-grid">
        <Panel className="col-7" title="Severity vs exploitation likelihood" sub="Amber = CISA KEV listed · bubble size fixed by listing state" noPad>
          <Chart option={scatterOption} height={312} />
          <div className="chart-legend">
            <span className="legend-item">
              <i style={{ background: AMBER }} /> KEV listed
            </span>
            <span className="legend-item">
              <i style={{ background: TEAL }} /> Not in KEV (yet)
            </span>
            <span className="legend-item dim">High CVSS does not imply high EPSS.</span>
          </div>
        </Panel>
        <Panel className="col-5" title="CVSS distribution" sub="18 real CVE records" noPad>
          <Chart option={histOption} height={312} />
          <div className="chart-legend" style={{ justifyContent: 'center' }}>
            <span className="legend-item dim">Binned by integer CVSS base score</span>
          </div>
        </Panel>

        <Panel
          className="col-12"
          title="CVE register"
          sub={`${filtered.length} of ${liveCves.length} records · real identifiers, demo context`}
          action={
            <span className={lastFetch ? 'badge real' : 'badge simulated'}>
              {lastFetch ? 'Live pull · cached' : 'Seed snapshot'}
            </span>
          }
          noPad
        >
          <div className="filters-bar">
            <div className="topbar-search" style={{ maxWidth: 310 }}>
              <Search size={13} />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search CVE, product, CWE…"
                aria-label="Search CVEs"
              />
            </div>
            <div className="seg">
              {(['ALL', 'CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const).map((b) => (
                <button key={b} className={band === b ? 'on' : undefined} onClick={() => setBand(b)}>
                  {b === 'ALL' ? 'All severities' : b}
                </button>
              ))}
            </div>
            <div className="filters-spacer" />
            <button
              className="chip"
              onClick={() => setKevOnly((v) => !v)}
              aria-pressed={kevOnly}
              style={kevOnly ? { color: 'var(--amber)', borderColor: 'rgba(227,164,85,.4)' } : undefined}
            >
              <ShieldAlert size={12} /> KEV only
            </button>
          </div>
          {filtered.length === 0 ? (
            <EmptyState title="No CVE matches" hint="Clear the severity band or the search." />
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>CVE</th>
                    <th>Product</th>
                    <th className="right">CVSS</th>
                    <th>Severity</th>
                    <th className="right">EPSS</th>
                    <th>Affected range</th>
                    <th>KEV</th>
                    <th className="right">Published</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((c) => (
                    <tr key={c.id} className="clickable" onClick={() => setSelectedId(c.id)}>
                      <td>
                        <div className="cell-title mono">{c.id}</div>
                        <div className="cell-sub">{c.title}</div>
                      </td>
                      <td className="cell-sub">
                        {c.vendor} {c.product}
                      </td>
                      <td className="right">
                        <span className="mono" style={{ color: c.cvss && c.cvss >= 9 ? 'var(--critical)' : undefined }}>
                          {c.cvss?.toFixed(1) ?? '—'}
                        </span>
                      </td>
                      <td>
                        <SeverityBadge level={c.severity} />
                      </td>
                      <td className="right mono">{c.epss == null ? '—' : fmtPct(c.epss)}</td>
                      <td className="cell-sub mono" style={{ fontSize: 9 }}>
                        {rangeLabel(c)}
                      </td>
                      <td>{c.kev ? <span className="badge high">KEV</span> : <span className="dim mono">—</span>}</td>
                      <td className="right mono">{fmtDate(c.published)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="table-note">
            <span className="inline-flex">
              <ShieldAlert size={11} /> {alerts.length} correlation candidates reference these records; {activeAlerts.length} survive relevance.
            </span>
            <span className="mono">
              {lastFetch ? `live pull ${fmtDateTime(lastFetch)} · cached in browser` : `snapshot ${DEMO_NOW.toISOString().slice(0, 10)}`}
            </span>
          </div>
        </Panel>

        <StatsPanel
          className="col-12"
          stats={[
            { name: 'KEV proportion', value: `${((kevCount / liveCves.length) * 100).toFixed(1)}%`, formula: 'KEV-listed ÷ CVEs', n: liveCves.length },
            { name: 'Median CVSS', value: (median(liveCves.map((c) => c.cvss ?? 0))).toFixed(1), formula: 'median base score', n: liveCves.length },
            { name: 'p90 EPSS', value: fmtPct(quantile(liveCves.map((c) => c.epss ?? 0), 0.9)), formula: '90th percentile EPSS', n: liveCves.length },
            { name: 'Mean EPSS', value: fmtPct(liveCves.reduce((a, b) => a + (b.epss ?? 0), 0) / liveCves.length), formula: 'arithmetic mean', n: liveCves.length },
            { name: 'CVEs with CPE ranges', value: String(liveCves.filter((c) => rangeLabel(c) !== 'not published').length), formula: 'range present in demo CPE data', n: liveCves.length },
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
  const related = alerts.filter((a) => a.cve.id === cve.id)
  const patch = useLiveFeeds((s) => s.patches[cve.id])
  const liveRows = [
    {
      label: 'NVD record',
      at: patch?.nvdAt,
      detail: patch?.nvdAt ? `CVSS ${cve.cvss?.toFixed(1) ?? '—'} · ${cve.cwe.length} CWE · ${cve.refs.length} refs` : 'seed snapshot',
    },
    {
      label: 'FIRST EPSS',
      at: patch?.epssAt,
      detail: patch?.epss == null ? 'seed snapshot' : `EPSS ${fmtPct(patch.epss)} · p${Math.round((patch.epssPercentile ?? 0) * 100)}`,
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
            <span className="badge real">NVD</span>
            <span className="badge real">FIRST EPSS</span>
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
          <h3>Affected range</h3>
          <div className="action-box">
            <div className="mono" style={{ fontSize: 13, color: 'var(--teal)' }}>
              {rangeLabel(cve)}
            </div>
            <p style={{ fontSize: 11.5, color: 'var(--text-dim)', marginTop: 6 }}>
              Installed versions inside this range are MATCHED. Versions outside are suppressed with the reason
              kept on the alert. Fix version in this demo: <span className="mono">{cve.fixVersion}</span>.
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
            <EmptyState title="No alert from this CVE" hint="None of the demo assets meet the relevance gate." />
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
                <span className={row.at ? 'check' : 'dim'}>{row.at ? '✓' : '·'}</span>
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
              No live pull for this record yet; values come from the demo seed. Use “Sync live feeds”.
            </p>
          )}
        </div>

        <div className="drawer-section">
          <h3>Timestamps</h3>
          <div className="provenance-list">
            <div className="provenance-row">
              <span className="check">✓</span>
              <span>Published</span>
              <span className="time">{fmtDate(cve.published)}</span>
            </div>
            <div className="provenance-row">
              <span className="check">✓</span>
              <span>Last modified</span>
              <span className="time">{fmtDate(cve.modified)}</span>
            </div>
            <div className="provenance-row">
              <span className="check">✓</span>
              <span>EPSS snapshot</span>
              <span className="time">{patch?.epssAt ? fmtDate(patch.epssAt) : fmtDate(DEMO_NOW.toISOString())}</span>
            </div>
          </div>
        </div>

        <div className="drawer-section">
          <SimulatedBadge /> <span className="dim" style={{ fontSize: 11 }}>Asset correlation is demo context; the CVE record is real.</span>
        </div>
      </div>
    </>
  )
}
