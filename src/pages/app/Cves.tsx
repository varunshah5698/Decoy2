import { useMemo, useState } from 'react'
import { Chart, axisStyle } from '../../components/Chart'
import { PageHeader, Panel } from '../../components/Panel'
import { Drawer, DrawerHead } from '../../components/Drawer'
import { StatsPanel } from '../../components/StatsPanel'
import { SeverityBadge, SourceBadge, SimulatedBadge } from '../../components/Badges'
import { EmptyState } from '../../components/EmptyState'
import { ExternalLink, Search, ShieldAlert } from '../../components/Icons'
import { activeAlerts, alerts, cves, DEMO_NOW } from '../../data/seed'
import { useFilters, useTheme } from '../../lib/store'
import { fmtDate, fmtPct, fmtScore } from '../../lib/format'
import { median, quantile } from '../../lib/stats'
import { AMBER, LEVEL_COLORS, TEAL, hexA } from '../../lib/colors'
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
  const [selected, setSelected] = useState<Cve | null>(null)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return cves
      .filter((c) => (kevOnly ? c.kev : true))
      .filter((c) => (band === 'ALL' ? true : c.severity === band))
      .filter((c) =>
        q ? `${c.id} ${c.title} ${c.vendor} ${c.product} ${c.cwe.join(' ')}`.toLowerCase().includes(q) : true,
      )
      .sort((a, b) => (b.cvss ?? 0) - (a.cvss ?? 0) || (b.epss ?? 0) - (a.epss ?? 0))
  }, [kevOnly, band, query])

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
          data: cves.map((c) => [c.cvss ?? 0, c.epss ?? 0, c.kev ? 16 : 9, c.id, c.title]),
          symbolSize: (v: any) => v[2],
          itemStyle: {
            color: (p: any) => (p.data[3] && cves.find((c) => c.id === p.data[3])?.kev ? hexA(AMBER, 0.82) : hexA(TEAL, 0.6)),
            borderColor: 'rgba(5,8,14,0.6)',
            borderWidth: 1,
          },
          emphasis: { scale: 1.3 },
        },
      ],
    }
  }, [theme])

  const histOption = useMemo(() => {
    const bins = Array.from({ length: 10 }, (_, i) => i)
    const data = bins.map((b) => cves.filter((c) => c.cvss != null && Math.floor(c.cvss) === b).length)
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
  }, [theme])

  const kevCount = cves.filter((c) => c.kev).length
  const medianEpss = median(cves.map((c) => c.epss ?? 0))

  return (
    <div className="page">
      <PageHeader
        eyebrow="COMPONENT 07 · CVE EXPLORER"
        title="Real IDs, readable ranges"
        description="Every CVE below exists in NVD. Components 1–15 consume these records; the affected ranges are written the way an engineer needs to read them."
        actions={
          <a className="btn btn-ghost btn-sm" href="https://nvd.nist.gov/" target="_blank" rel="noreferrer">
            NVD <ExternalLink size={12} />
          </a>
        }
      />

      <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(5, minmax(0,1fr))' }}>
        <div className="kpi">
          <div className="kpi-label">CVEs in demo window</div>
          <div className="kpi-value">{cves.length}</div>
          <div className="kpi-delta">real public identifiers</div>
        </div>
        <div className="kpi amber-tone">
          <div className="kpi-label">In CISA KEV</div>
          <div className="kpi-value">{kevCount}</div>
          <div className="kpi-delta">known exploited</div>
        </div>
        <div className="kpi critical-tone">
          <div className="kpi-label">Max CVSS</div>
          <div className="kpi-value">{Math.max(...cves.map((c) => c.cvss ?? 0)).toFixed(1)}</div>
          <div className="kpi-delta">Log4Shell</div>
        </div>
        <div className="kpi teal-tone">
          <div className="kpi-label">Median EPSS</div>
          <div className="kpi-value">{fmtPct(medianEpss)}</div>
          <div className="kpi-delta">30-day exploitation probability</div>
        </div>
        <div className="kpi high-tone">
          <div className="kpi-label">With affected ranges</div>
          <div className="kpi-value">{cves.filter((c) => rangeLabel(c) !== 'not published').length}</div>
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
          sub={`${filtered.length} of ${cves.length} records · real identifiers, demo context`}
          action={<span className="badge real">NVD · KEV · EPSS</span>}
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
                    <tr key={c.id} className="clickable" onClick={() => setSelected(c)}>
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
            <span className="mono">snapshot {DEMO_NOW.toISOString().slice(0, 10)}</span>
          </div>
        </Panel>

        <StatsPanel
          className="col-12"
          stats={[
            { name: 'KEV proportion', value: `${((kevCount / cves.length) * 100).toFixed(1)}%`, formula: 'KEV-listed ÷ CVEs', n: cves.length },
            { name: 'Median CVSS', value: (median(cves.map((c) => c.cvss ?? 0))).toFixed(1), formula: 'median base score', n: cves.length },
            { name: 'p90 EPSS', value: fmtPct(quantile(cves.map((c) => c.epss ?? 0), 0.9)), formula: '90th percentile EPSS', n: cves.length },
            { name: 'Mean EPSS', value: fmtPct(cves.reduce((a, b) => a + (b.epss ?? 0), 0) / cves.length), formula: 'arithmetic mean', n: cves.length },
            { name: 'CVEs with CPE ranges', value: String(cves.filter((c) => rangeLabel(c) !== 'not published').length), formula: 'range present in demo CPE data', n: cves.length },
          ]}
        />
      </div>

      <Drawer open={Boolean(selected)} onClose={() => setSelected(null)} label={selected ? selected.id : 'CVE'}>
        {selected && <CveDetail cve={selected} onClose={() => setSelected(null)} />}
      </Drawer>
    </div>
  )
}

function CveDetail({ cve, onClose }: { cve: Cve; onClose: () => void }) {
  const related = alerts.filter((a) => a.cve.id === cve.id)
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
              <span className="time">{DEMO_NOW.toISOString().slice(0, 10)}</span>
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
