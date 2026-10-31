import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PageHeader, Panel } from '../../components/Panel'
import { StatsPanel } from '../../components/StatsPanel'
import { SeverityBadge, RelevanceBadge, SimulatedBadge } from '../../components/Badges'
import { ArrowRight, Info, Network, Search, ShieldAlert } from '../../components/Icons'
import { alerts, assets, cves, DEMO_NOW } from '../../data/seed'
import { useFilters, useTheme } from '../../lib/store'
import { fmtScore, timeAgo } from '../../lib/format'
import { LEVEL_COLORS, TEAL, hexA } from '../../lib/colors'

interface GNode {
  id: string
  label: string
  kind: 'asset' | 'cve' | 'hub'
  x: number
  y: number
  r: number
  color: string
  meta: string
}

const W = 900
const H = 580
const CX = W / 2
const CY = H / 2

export default function Graph() {
  const theme = useTheme((s) => s.theme)
  const navigate = useNavigate()
  const query = useFilters((s) => s.query)
  const setQuery = useFilters((s) => s.setQuery)
  const [hover, setHover] = useState<string | null>(null)
  const [selected, setSelected] = useState<string>('AST-HR-01')

  const nodes = useMemo<GNode[]>(() => {
    const assetNodes: GNode[] = assets.map((a, i) => {
      const angle = (i / assets.length) * Math.PI * 2 - Math.PI / 2
      const rr = 150
      return {
        id: a.id,
        label: a.name,
        kind: 'asset',
        x: CX + Math.cos(angle) * rr,
        y: CY + Math.sin(angle) * rr,
        r: a.criticality === 'HIGH' ? 14 : a.criticality === 'MEDIUM' ? 10 : 7.5,
        color: a.internetFacing ? '#e08a2f' : TEAL,
        meta: `${a.department} · ${a.criticality}`,
      }
    })

    const cveNodes: GNode[] = cves.map((c, i) => {
      const angle = (i / cves.length) * Math.PI * 2 - Math.PI / 2 + 0.09
      const rr = 258
      const linked = alerts.filter((a) => a.cve.id === c.id)
      const top = linked.some((a) => a.level === 'CRITICAL')
        ? 'CRITICAL'
        : linked.some((a) => a.level === 'HIGH')
          ? 'HIGH'
          : linked.some((a) => a.level === 'MEDIUM')
            ? 'MEDIUM'
            : 'LOW'
      return {
        id: c.id,
        label: c.id,
        kind: 'cve',
        x: CX + Math.cos(angle) * rr,
        y: CY + Math.sin(angle) * rr,
        r: 5 + (c.cvss ?? 0) * 0.55,
        color: LEVEL_COLORS[top],
        meta: `${c.vendor} ${c.product} · CVSS ${c.cvss?.toFixed(1) ?? '—'}`,
      }
    })

    return [
      { id: 'hub', label: 'AEGIS', kind: 'hub', x: CX, y: CY, r: 34, color: TEAL, meta: 'correlation core' },
      ...assetNodes,
      ...cveNodes,
    ]
  }, [])

  const nodeById = useMemo(() => Object.fromEntries(nodes.map((n) => [n.id, n])) as Record<string, GNode>, [nodes])

  const edges = useMemo(
    () =>
      alerts.map((a) => {
        const from = nodeById[a.cve.id]
        const to = nodeById[a.asset.id]
        const mx = (from.x + to.x) / 2
        const my = (from.y + to.y) / 2
        const dx = to.x - from.x
        const dy = to.y - from.y
        const len = Math.hypot(dx, dy) || 1
        const curve = 18
        return {
          id: a.id,
          alert: a,
          from,
          to,
          path: `M ${from.x} ${from.y} Q ${mx - (dy / len) * curve} ${my + (dx / len) * curve} ${to.x} ${to.y}`,
          color: a.suppressed ? 'rgba(107,122,141,0.35)' : hexA(LEVEL_COLORS[a.level], 0.55),
        }
      }),
    [nodeById],
  )

  const connectedIds = useMemo(() => {
    const active = hover ?? selected
    if (!active) return null
    const set = new Set<string>([active])
    edges.forEach((e) => {
      if (e.alert.cve.id === active || e.alert.asset.id === active) {
        set.add(e.from.id)
        set.add(e.to.id)
      }
    })
    return set
  }, [hover, selected, edges])

  const q = query.trim().toLowerCase()
  const matches = (n: GNode) => !q || n.label.toLowerCase().includes(q) || n.meta.toLowerCase().includes(q)

  const focused = nodeById[selected]
  const focusedAlerts =
    focused?.kind === 'asset'
      ? alerts.filter((a) => a.asset.id === focused.id)
      : focused?.kind === 'cve'
        ? alerts.filter((a) => a.cve.id === focused.id)
        : alerts.slice(0, 6)

  const dim = (id: string) => {
    if (!connectedIds) return false
    if (connectedIds.has(id)) return false
    return true
  }

  return (
    <div className="page">
      <PageHeader
        eyebrow="COMPONENT 04 · NETWORK GRAPH"
        title="Follow the edge to a real system"
        description="Assets sit on the inner ring, CVEs on the outer ring. Only correlation edges that pass the version gate receive a colour — suppressed edges fade to grey."
        actions={
          <span className="chip">
            <Network size={12} /> {edges.length} correlation edges
          </span>
        }
      />

      <div className="dash-grid">
        <Panel
          className="col-8"
          title="Correlation graph"
          sub="Hover to isolate a neighbourhood · click a node to inspect"
          action={
            <div className="topbar-search" style={{ maxWidth: 210, height: 30 }}>
              <Search size={12} />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Find node…"
                aria-label="Find graph node"
              />
            </div>
          }
          noPad
        >
          <div className="graph-wrap" style={{ height: 580 }}>
            <svg viewBox={`0 0 ${W} ${H}`} className="graph-svg" role="img" aria-label="Asset and CVE correlation graph">
              <defs>
                <radialGradient id="hub-glow">
                  <stop offset="0%" stopColor={TEAL} stopOpacity="0.35" />
                  <stop offset="100%" stopColor={TEAL} stopOpacity="0" />
                </radialGradient>
                <pattern id="graph-grid" width="26" height="26" patternUnits="userSpaceOnUse">
                  <circle cx="1" cy="1" r="0.7" fill="rgba(150,168,192,0.16)" />
                </pattern>
              </defs>
              <rect width={W} height={H} fill="url(#graph-grid)" />
              <circle cx={CX} cy={CY} r={150} fill="none" stroke="rgba(150,168,192,0.09)" strokeDasharray="2 6" />
              <circle cx={CX} cy={CY} r={258} fill="none" stroke="rgba(150,168,192,0.07)" strokeDasharray="2 8" />
              <circle cx={CX} cy={CY} r={96} fill="url(#hub-glow)" />

              <g>
                {edges.map((e) => {
                  const active = hover === e.alert.cve.id || hover === e.alert.asset.id || selected === e.alert.cve.id || selected === e.alert.asset.id
                  return (
                    <path
                      key={e.id}
                      d={e.path}
                      fill="none"
                      stroke={e.color}
                      strokeWidth={active ? 1.8 : 0.8}
                      opacity={dim(e.alert.cve.id) && dim(e.alert.asset.id) ? 0.18 : active ? 0.95 : 0.4}
                      style={{ transition: 'opacity .25s ease, stroke-width .2s ease' }}
                    />
                  )
                })}
              </g>

              {nodes.map((n) => {
                const isDim = dim(n.id) || !matches(n)
                return (
                  <g
                    key={n.id}
                    className={`graph-node${selected === n.id ? ' active' : ''}`}
                    opacity={isDim ? 0.3 : 1}
                    onMouseEnter={() => setHover(n.id)}
                    onMouseLeave={() => setHover(null)}
                    onClick={() => setSelected(n.id)}
                    tabIndex={0}
                    role="button"
                    aria-label={`${n.label} ${n.kind}`}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') setSelected(n.id)
                    }}
                  >
                    <circle
                      cx={n.x}
                      cy={n.y}
                      r={selected === n.id ? n.r + 5 : n.r}
                      fill={n.kind === 'hub' ? 'rgba(62,210,193,0.12)' : hexA(n.color, n.kind === 'cve' ? 0.7 : 0.28)}
                      stroke={n.color}
                      strokeWidth={n.kind === 'hub' ? 1.6 : 1.2}
                    />
                    {n.kind === 'hub' && (
                      <text
                        x={n.x}
                        y={n.y + 3.5}
                        textAnchor="middle"
                        style={{ fontSize: 9, fontFamily: 'monospace', fill: TEAL, opacity: 1 }}
                      >
                        CORE
                      </text>
                    )}
                    {n.kind === 'asset' && (
                      <text
                        x={n.x}
                        y={n.y + n.r + 12}
                        textAnchor="middle"
                        style={{
                          fontSize: 8,
                          fontFamily: 'monospace',
                          fill: theme === 'dark' ? '#98a5b8' : '#596474',
                          opacity: 0.85,
                        }}
                      >
                        {n.label}
                      </text>
                    )}
                    {n.kind === 'cve' && (
                      <text
                        x={n.x}
                        y={n.y + n.r + 10}
                        textAnchor="middle"
                        style={{
                          fontSize: 7,
                          fontFamily: 'monospace',
                          fill: theme === 'dark' ? '#647184' : '#7d8796',
                          opacity: selected === n.id || hover === n.id ? 1 : 0,
                        }}
                      >
                        {n.label}
                      </text>
                    )}
                  </g>
                )
              })}
            </svg>
          </div>
          <div className="chart-legend" style={{ padding: '12px 18px' }}>
            <span className="legend-item">
              <i style={{ background: TEAL, borderRadius: '50%' }} /> internal asset
            </span>
            <span className="legend-item">
              <i style={{ background: '#e08a2f', borderRadius: '50%' }} /> internet-facing
            </span>
            <span className="legend-item">
              <i style={{ background: LEVEL_COLORS.CRITICAL, borderRadius: '50%' }} /> CVE node
            </span>
            <span className="legend-item">
              <i style={{ background: 'rgba(107,122,141,0.5)' }} /> suppressed edge
            </span>
          </div>
        </Panel>

        <Panel
          className="col-4"
          title={focused ? focused.label : 'Selection'}
          sub={focused ? focused.meta : 'Select a node'}
          action={<SimulatedBadge />}
          bodyClass="panel-body"
        >
          {focused && (
            <div style={{ display: 'grid', gap: 12 }}>
              <div className="inline-flex" style={{ flexWrap: 'wrap', gap: 6 }}>
                <span className="badge real">{focused.kind === 'asset' ? 'SIMULATED ASSET' : 'NVD CVE'}</span>
                <span className="mono" style={{ fontSize: 9 }}>
                  {focusedAlerts.length} connected alert{focusedAlerts.length === 1 ? '' : 's'}
                </span>
              </div>
              <div style={{ display: 'grid', gap: 8 }}>
                {focusedAlerts.map((a) => (
                  <button
                    key={a.id}
                    className="action-box"
                    onClick={() => navigate(`/app/alerts?alert=${a.id}`)}
                    style={{ textAlign: 'left', cursor: 'pointer' }}
                  >
                    <div className="inline-flex" style={{ justifyContent: 'space-between', width: '100%' }}>
                      <strong style={{ fontSize: 11.5 }}>
                        {focused.kind === 'asset' ? a.cve.id : a.asset.name}
                      </strong>
                      <SeverityBadge level={a.level} suppressed={a.suppressed} />
                    </div>
                    <div className="inline-flex" style={{ justifyContent: 'space-between', width: '100%', marginTop: 6 }}>
                      <span className="mono" style={{ fontSize: 8.5 }}>{a.relevance}</span>
                      <span className={`score-cell ${a.suppressed ? 'suppressed' : a.level.toLowerCase()}`} style={{ fontSize: 15 }}>
                        {fmtScore(a.score)}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
              <p className="dim" style={{ fontSize: 11, lineHeight: 1.6 }}>
                Edges represent one alert per (CVE, asset). The graph never invents a link: every line comes from a
                correlation candidate, including the suppressed ones.
              </p>
            </div>
          )}
        </Panel>

        <Panel
          className="col-12"
          title="Edges"
          sub={`${edges.length} candidate links · ${edges.filter((e) => !e.alert.suppressed).length} active`}
          action={<span className="badge simulated">assets simulated</span>}
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
                  <th className="right">Score</th>
                  <th className="right">Raised</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {edges.map((e) => (
                  <tr key={e.id} className="clickable" onClick={() => setSelected(e.alert.asset.id)}>
                    <td className="mono">{e.alert.cve.id}</td>
                    <td>
                      <div className="cell-title">{e.alert.asset.name}</div>
                      <div className="cell-sub">{e.alert.asset.department}</div>
                    </td>
                    <td>
                      <RelevanceBadge relevance={e.alert.relevance} />
                    </td>
                    <td>
                      <SeverityBadge level={e.alert.level} suppressed={e.alert.suppressed} />
                    </td>
                    <td className="right">
                      <span className={`score-cell ${e.alert.suppressed ? 'suppressed' : e.alert.level.toLowerCase()}`}>
                        {fmtScore(e.alert.score)}
                      </span>
                    </td>
                    <td className="right mono">{timeAgo(e.alert.createdAt, DEMO_NOW)}</td>
                    <td className="right">
                      <button
                        className="panel-link"
                        onClick={(ev) => {
                          ev.stopPropagation()
                          navigate(`/app/alerts?alert=${e.id}`)
                        }}
                      >
                        {e.id} <ArrowRight size={11} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="table-note">
            <span className="inline-flex">
              <Info size={11} /> Suppressed edges remain drawn in grey so the gate is auditable.
            </span>
            <span className="mono">
              <ShieldAlert size={10} style={{ display: 'inline', marginRight: 4 }} />
              2 suppressed edges
            </span>
          </div>
        </Panel>

        <StatsPanel
          className="col-12"
          stats={[
            { name: 'Graph density', value: ((2 * edges.length) / (nodes.length * (nodes.length - 1))).toFixed(4), formula: '2E ÷ V(V−1)', n: nodes.length },
            { name: 'Mean edges per asset', value: (edges.length / assets.length).toFixed(2), formula: 'edges ÷ 16 assets', n: assets.length },
            { name: 'Unlinked CVEs', value: String(cves.filter((c) => !alerts.some((a) => a.cve.id === c.id)).length), formula: 'CVEs with no inventory hit', n: cves.length },
            { name: 'Suppressed edges', value: String(edges.filter((e) => e.alert.suppressed).length), formula: 'edges with relevance gate applied', n: edges.length },
            { name: 'Node count', value: String(nodes.length), formula: '1 hub + 16 assets + 18 CVEs', n: nodes.length },
          ]}
        />
      </div>
    </div>
  )
}
