import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Chart, axisStyle } from '../../components/Chart'
import { PageHeader, Panel } from '../../components/Panel'
import { Drawer, DrawerHead } from '../../components/Drawer'
import { StatsPanel } from '../../components/StatsPanel'
import { CriticalityBadge, SeverityBadge, SimulatedBadge } from '../../components/Badges'
import { EmptyState } from '../../components/EmptyState'
import { ArrowRight, Globe2, Network, Search, Server, Upload } from '../../components/Icons'
import { activeAlerts, alerts, assets, departments } from '../../data/seed'
import { useAuth, useFilters, useTheme } from '../../lib/store'
import { fmtScore, timeAgo } from '../../lib/format'
import { mean, median } from '../../lib/stats'
import { LEVEL_COLORS, TEAL, hexA } from '../../lib/colors'
import type { Asset, Criticality, RiskLevel } from '../../lib/types'

const assetAlerts = (assetId: string) => activeAlerts.filter((a) => a.asset.id === assetId)

const topLevel = (list: ReturnType<typeof assetAlerts>): RiskLevel | null =>
  (['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as RiskLevel[]).find((l) => list.some((a) => a.level === l)) ?? null

export default function Assets() {
  const theme = useTheme((s) => s.theme)
  const navigate = useNavigate()
  const session = useAuth((s) => s.session)
  const query = useFilters((s) => s.query)
  const setQuery = useFilters((s) => s.setQuery)
  const [dept, setDept] = useState('ALL')
  const [criticality, setCriticality] = useState<'ALL' | Criticality>('ALL')
  const [exposure, setExposure] = useState<'ALL' | 'EXPOSED' | 'INTERNAL'>('ALL')
  const [selected, setSelected] = useState<Asset | null>(null)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return assets
      .filter((a) => (dept === 'ALL' ? true : a.department === dept))
      .filter((a) => (criticality === 'ALL' ? true : a.criticality === criticality))
      .filter((a) => (exposure === 'ALL' ? true : exposure === 'EXPOSED' ? a.internetFacing : !a.internetFacing))
      .filter((a) =>
        q
          ? `${a.name} ${a.department} ${a.software.map((s) => `${s.vendor} ${s.product} ${s.version}`).join(' ')}`
              .toLowerCase()
              .includes(q)
          : true,
      )
      .sort((a, b) => {
        const am = Math.max(0, ...assetAlerts(a.id).map((x) => x.score))
        const bm = Math.max(0, ...assetAlerts(b.id).map((x) => x.score))
        return bm - am
      })
  }, [dept, criticality, exposure, query])

  const exposureOption = useMemo(() => {
    const sorted = [...assets]
      .map((a) => ({ asset: a, alerts: assetAlerts(a.id), top: topLevel(assetAlerts(a.id)) }))
      .sort(
        (a, b) =>
          Math.max(0, ...b.alerts.map((x) => x.score)) - Math.max(0, ...a.alerts.map((x) => x.score)),
      )
      .slice(0, 10)
    const ax = axisStyle(theme)
    return {
      grid: { left: 104, right: 30, top: 16, bottom: 22 },
      xAxis: { type: 'value', min: 0, max: 100, ...ax, axisLabel: { ...ax.axisLabel, fontSize: 8 } },
      yAxis: {
        type: 'category',
        data: sorted.map((s) => s.asset.name),
        ...ax,
        splitLine: { show: false },
        axisLabel: { ...ax.axisLabel, color: theme === 'dark' ? '#98a5b8' : '#596474', fontSize: 8.5 },
      },
      tooltip: {
        formatter: (p: any) => {
          const s = sorted[p.dataIndex]
          return `${s.asset.name}<br/>top score ${fmtScore(p.value)}<br/>${s.alerts.length} active alerts`
        },
      },
      series: [
        {
          type: 'bar',
          barWidth: '58%',
          data: sorted.map((s) => ({
            value: Math.max(0, ...s.alerts.map((x) => x.score)),
            itemStyle: {
              color: s.top ? hexA(LEVEL_COLORS[s.top], 0.86) : hexA(TEAL, 0.3),
              borderRadius: [0, 3, 3, 0],
            },
          })),
          label: {
            show: true,
            position: 'right',
            color: theme === 'dark' ? '#647184' : '#7d8796',
            fontSize: 8,
            fontFamily: 'monospace',
            formatter: (p: any) => (p.value ? fmtScore(p.value) : 'clean'),
          },
        },
      ],
    }
  }, [theme])

  const typeOption = useMemo(() => {
    const types = [...new Set(assets.map((a) => a.type))]
    const colors: Record<string, string> = {
      server: TEAL,
      app: '#e3a455',
      endpoint: '#9b7bd4',
      network: '#e08a2f',
      database: '#e5545a',
      cloud: '#3fae74',
    }
    return {
      tooltip: { trigger: 'item', formatter: '{b}: {c} assets ({d}%)' },
      series: [
        {
          type: 'pie',
          radius: ['54%', '76%'],
          center: ['50%', '46%'],
          itemStyle: {
            borderColor: theme === 'dark' ? '#0a1019' : '#fbf9f4',
            borderWidth: 3,
            borderRadius: 4,
          },
          label: {
            color: theme === 'dark' ? '#98a5b8' : '#596474',
            fontSize: 9,
            fontFamily: 'monospace',
            formatter: '{b}\n{c}',
          },
          labelLine: { lineStyle: { color: theme === 'dark' ? 'rgba(150,168,192,.3)' : 'rgba(23,30,40,.2)' } },
          data: types.map((t) => ({
            name: t,
            value: assets.filter((a) => a.type === t).length,
            itemStyle: { color: colors[t] ?? TEAL },
          })),
        },
      ],
    }
  }, [theme])

  const criticalAssets = assets.filter((a) => a.criticality === 'HIGH')
  const exposed = assets.filter((a) => a.internetFacing)
  const versioned = assets.filter((a) => a.software.every((s) => s.version !== 'unknown'))
  const perAsset = assets.map((a) => assetAlerts(a.id).length)

  return (
    <div className="page">
      <PageHeader
        eyebrow="COMPONENT 06 · ASSET EXPOSURE"
        title="Your side of the correlation"
        description="Sixteen demo systems, their software versions, and exactly which alerts land on each. Version is the hinge: a product name alone is not a match."
        actions={
          <>
            <button className="btn btn-ghost btn-sm" onClick={() => navigate('/app/cves')}>
              <Search size={13} /> CVE explorer
            </button>
            <button
              className="btn btn-primary btn-sm"
              onClick={() => navigate('/app/uploads')}
              disabled={session?.role !== 'ADMIN'}
              title={session?.role !== 'ADMIN' ? 'Admin access required for ingestion' : undefined}
            >
              <Upload size={13} /> Upload inventory
            </button>
          </>
        }
      />

      <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(5, minmax(0,1fr))' }}>
        <div className="kpi">
          <div className="kpi-label">Assets inventoried</div>
          <div className="kpi-value">{assets.length}</div>
          <div className="kpi-delta">
            <SimulatedBadge /> seeded inventory
          </div>
        </div>
        <div className="kpi teal-tone">
          <div className="kpi-label">Internet-facing</div>
          <div className="kpi-value">{exposed.length}</div>
          <div className="kpi-delta">+5 exposure points each</div>
        </div>
        <div className="kpi high-tone">
          <div className="kpi-label">Criticality HIGH</div>
          <div className="kpi-value">{criticalAssets.length}</div>
          <div className="kpi-delta">25 criticality points</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Version known</div>
          <div className="kpi-value">
            {versioned.length}
            <small>/ {assets.length}</small>
          </div>
          <div className="kpi-delta">{assets.length - versioned.length} needs verification</div>
        </div>
        <div className="kpi amber-tone">
          <div className="kpi-label">Department spread</div>
          <div className="kpi-value">{departments.length}</div>
          <div className="kpi-delta">business-unit ownership</div>
        </div>
      </div>

      <div className="dash-grid">
        <Panel
          className="col-7"
          title="Highest-scoring asset per system"
          sub="Top 10 by maximum active alert score"
          noPad
        >
          <Chart option={exposureOption} height={330} />
        </Panel>

        <Panel className="col-5" title="Inventory composition" sub="Asset types in the demo inventory" noPad>
          <Chart option={typeOption} height={300} />
          <div className="chart-legend" style={{ justifyContent: 'center' }}>
            <span className="legend-item">
              <i style={{ background: TEAL }} /> {assets.length} systems
            </span>
            <span className="legend-item dim">Version-aware on {versioned.length}</span>
          </div>
        </Panel>

        <Panel
          className="col-12"
          title="Asset register"
          sub={`${filtered.length} of ${assets.length} assets · sorted by maximum score`}
          action={<span className="badge simulated">Simulated inventory</span>}
          noPad
        >
          <div className="filters-bar">
            <div className="topbar-search" style={{ maxWidth: 280 }}>
              <Search size={13} />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search asset or software…"
                aria-label="Search assets"
              />
            </div>
            <select className="select" style={{ width: 190 }} value={dept} onChange={(e) => setDept(e.target.value)} aria-label="Department">
              <option value="ALL">All departments</option>
              {departments.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
            <div className="seg">
              {(['ALL', 'HIGH', 'MEDIUM', 'LOW'] as const).map((c) => (
                <button key={c} className={criticality === c ? 'on' : undefined} onClick={() => setCriticality(c)}>
                  {c === 'ALL' ? 'Any criticality' : c}
                </button>
              ))}
            </div>
            <div className="filters-spacer" />
            <div className="seg">
              {(['ALL', 'EXPOSED', 'INTERNAL'] as const).map((e) => (
                <button key={e} className={exposure === e ? 'on' : undefined} onClick={() => setExposure(e)}>
                  {e === 'ALL' ? 'Any exposure' : e === 'EXPOSED' ? 'Internet-facing' : 'Internal'}
                </button>
              ))}
            </div>
          </div>
          {filtered.length === 0 ? (
            <EmptyState title="No asset matches" hint="Reset the department or exposure filter." />
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Asset</th>
                    <th>Type</th>
                    <th>Department</th>
                    <th>Software</th>
                    <th>Criticality</th>
                    <th>Exposure</th>
                    <th className="right">Alerts</th>
                    <th className="right">Top score</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((a) => {
                    const list = assetAlerts(a.id)
                    const top = Math.max(0, ...list.map((x) => x.score))
                    const lvl = topLevel(list)
                    return (
                      <tr key={a.id} className="clickable" onClick={() => setSelected(a)}>
                        <td>
                          <div className="cell-title">{a.name}</div>
                          <div className="cell-sub">
                            {a.id} · {a.businessFunction}
                          </div>
                        </td>
                        <td className="mono" style={{ fontSize: 9.5 }}>
                          {a.type}
                        </td>
                        <td>{a.department}</td>
                        <td>
                          <div className="cell-sub">
                            {a.software.map((s) => `${s.vendor} ${s.product} ${s.version}`).join(' · ')}
                          </div>
                        </td>
                        <td>
                          <CriticalityBadge level={a.criticality} />
                        </td>
                        <td>{a.internetFacing ? <span className="badge high">Internet</span> : <span className="mono dim">internal</span>}</td>
                        <td className="right mono">{list.length}</td>
                        <td className="right">
                          {lvl ? (
                            <span className={`score-cell ${lvl.toLowerCase()}`}>{fmtScore(top)}</span>
                          ) : (
                            <span className="dim mono">—</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
          <div className="table-note">
            <span className="inline-flex">
              <Server size={11} /> Every row is seed data labelled SIMULATED. Replace it with a USER UPLOAD in the Data Input Hub.
            </span>
            <span className="mono">{activeAlerts.length} active alerts mapped</span>
          </div>
        </Panel>

        <StatsPanel
          className="col-12"
          stats={[
            { name: 'Mean alerts per asset', value: mean(perAsset).toFixed(2), formula: 'active alerts ÷ 16 assets', n: assets.length },
            { name: 'Median alerts per asset', value: median(perAsset).toFixed(1), formula: 'median', n: assets.length },
            { name: 'Internet-facing share', value: `${((exposed.length / assets.length) * 100).toFixed(0)}%`, formula: 'exposed ÷ total assets', n: assets.length },
            { name: 'High-criticality share', value: `${((criticalAssets.length / assets.length) * 100).toFixed(0)}%`, formula: 'HIGH ÷ total assets', n: assets.length },
            { name: 'Version certainty', value: `${((versioned.length / assets.length) * 100).toFixed(1)}%`, formula: 'assets with every version known', n: assets.length },
          ]}
        />
      </div>

      <Drawer open={Boolean(selected)} onClose={() => setSelected(null)} label={selected ? selected.name : 'Asset'}>
        {selected && <AssetDetail asset={selected} onClose={() => setSelected(null)} />}
      </Drawer>
    </div>
  )
}

function AssetDetail({ asset, onClose }: { asset: Asset; onClose: () => void }) {
  const list = alerts.filter((a) => a.asset.id === asset.id)
  const active = list.filter((a) => !a.suppressed)
  return (
    <>
      <DrawerHead
        overline={`${asset.id} · ${asset.type.toUpperCase()} · ${asset.department.toUpperCase()}`}
        title={asset.name}
        onClose={onClose}
        meta={
          <span className="inline-flex" style={{ flexWrap: 'wrap', gap: 8 }}>
            <CriticalityBadge level={asset.criticality} />
            {asset.internetFacing ? <span className="badge high">Internet-facing</span> : <span className="badge suppressed">Internal</span>}
            <span className="badge simulated">Simulated</span>
          </span>
        }
      />
      <div className="drawer-body">
        <div className="drawer-section">
          <p style={{ fontSize: 13, color: 'var(--text-dim)' }}>
            {asset.businessFunction}. Data sensitivity is {asset.sensitivity.toLowerCase()}.
          </p>
        </div>
        <div className="drawer-section">
          <h3>Installed software</h3>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Vendor</th>
                  <th>Product</th>
                  <th className="right">Version</th>
                </tr>
              </thead>
              <tbody>
                {asset.software.map((s) => (
                  <tr key={`${s.vendor}-${s.product}`}>
                    <td>{s.vendor}</td>
                    <td>{s.product}</td>
                    <td className="right mono">{s.version === 'unknown' ? 'unverified' : s.version}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="drawer-section">
          <h3>Correlated alerts</h3>
          {list.length === 0 ? (
            <EmptyState title="No correlation candidates" hint="No ingested CVE references this software." />
          ) : (
            <div style={{ display: 'grid', gap: 8 }}>
              {list.map((a) => (
                <div
                  key={a.id}
                  className="action-box"
                  style={{ borderColor: a.suppressed ? 'var(--line)' : hexA(LEVEL_COLORS[a.level], 0.3) }}
                >
                  <div className="inline-flex" style={{ justifyContent: 'space-between', width: '100%' }}>
                    <strong style={{ fontSize: 12 }}>{a.cve.id}</strong>
                    <span className="inline-flex" style={{ gap: 6 }}>
                      <SeverityBadge level={a.level} suppressed={a.suppressed} />
                      <span className="mono">{fmtScore(a.score)}</span>
                    </span>
                  </div>
                  <p style={{ fontSize: 11.5, color: 'var(--text-dim)', marginTop: 5 }}>{a.cve.title}</p>
                  <div className="mono" style={{ marginTop: 5, fontSize: 8.5 }}>
                    {a.relevance} · raised {timeAgo(a.createdAt)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="drawer-section">
          <h3>Exposure summary</h3>
          <div className="provenance-list">
            <div className="provenance-row">
              <Network size={12} className="check" />
              <span>Network position</span>
              <span className="time">{asset.internetFacing ? 'Internet-facing' : 'Internal only'}</span>
            </div>
            <div className="provenance-row">
              <Globe2 size={12} className="check" />
              <span>Correlated alerts</span>
              <span className="time">
                {active.length} active · {list.length - active.length} suppressed
              </span>
            </div>
          </div>
          <button className="btn btn-ghost btn-sm mt-16" onClick={onClose}>
            Close <ArrowRight size={13} />
          </button>
        </div>
      </div>
    </>
  )
}
