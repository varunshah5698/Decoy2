import { useMemo, useRef, useState, type CSSProperties } from 'react'
import type { Alert, Asset, Cve, RiskLevel } from '../lib/types'
import { LEVEL_COLORS, hexA } from '../lib/colors'
import { cx } from '../lib/format'
import { mulberry32 } from '../lib/stats'
import { sortAlerts, worstLevel } from '../lib/correlation'
import { ArrowRight } from './Icons'
import {
  AssetGlyph,
  HazardMarker,
  HubCore,
  IsoGradientDefs,
  IsoPlatform,
  TONES,
  type Glyph,
  type Tone,
} from './IsoArt'

const W = 1120
const H = 760
const CX = W / 2
const CY = 374
const INNER_RX = 296
const INNER_RY = 166
const OUTER_RX = 452
const OUTER_RY = 276

type Ring = 'inner' | 'outer'

interface Placement {
  id: string
  angle: number
  glyph: Glyph
  tone: Tone
  ring: Ring
}

const PLACEMENTS: Placement[] = [
  { id: 'AST-HR-01', angle: -90, glyph: 'crystal', tone: 'gold', ring: 'inner' },
  { id: 'AST-FIN-02', angle: -45, glyph: 'crystal', tone: 'teal', ring: 'inner' },
  { id: 'AST-NET-03', angle: 0, glyph: 'shield', tone: 'gold', ring: 'inner' },
  { id: 'AST-FIN-04', angle: 45, glyph: 'server', tone: 'blue', ring: 'inner' },
  { id: 'AST-IT-06', angle: 90, glyph: 'globe', tone: 'indigo', ring: 'inner' },
  { id: 'AST-FIN-12', angle: 135, glyph: 'cylinders', tone: 'violet', ring: 'inner' },
  { id: 'AST-CX-11', angle: 180, glyph: 'glass', tone: 'teal', ring: 'inner' },
  { id: 'AST-IT-10', angle: 225, glyph: 'server', tone: 'blue', ring: 'inner' },
  { id: 'AST-ENG-09', angle: -67.5, glyph: 'cloud', tone: 'indigo', ring: 'outer' },
  { id: 'AST-NET-07', angle: -22.5, glyph: 'shield', tone: 'gold', ring: 'outer' },
  { id: 'AST-IT-08', angle: 22.5, glyph: 'lock', tone: 'violet', ring: 'outer' },
  { id: 'AST-ENG-05', angle: 67.5, glyph: 'server', tone: 'blue', ring: 'outer' },
  { id: 'AST-IT-14', angle: 112.5, glyph: 'monitor', tone: 'teal', ring: 'outer' },
  { id: 'AST-IT-16', angle: 157.5, glyph: 'cylinders', tone: 'violet', ring: 'outer' },
  { id: 'AST-IT-13', angle: 202.5, glyph: 'beacon', tone: 'dim', ring: 'outer' },
  { id: 'AST-FAC-15', angle: 247.5, glyph: 'monitor', tone: 'blue', ring: 'outer' },
]

const EDGE_COLORS: Record<RiskLevel, string> = {
  CRITICAL: '#ff5f6d',
  HIGH: '#ffa94d',
  MEDIUM: '#f2d15c',
  LOW: '#4ed99a',
}

const SUPPRESSED_COLOR = '#74839a'

interface AssetNode {
  asset: Asset
  def: Placement
  x: number
  y: number
  scale: number
  angle: number
}

interface MarkerNode {
  key: string
  cve: Cve
  alerts: Alert[]
  primary: Alert
  node: AssetNode
  x: number
  y: number
  path: string
  start: { x: number; y: number }
  end: { x: number; y: number }
}

interface TipRow {
  label: string
  value: string
}

interface TipData {
  kicker: string
  title: string
  tone: string
  rows: TipRow[]
  note?: string
}

const scaleFor = (asset: Asset) =>
  asset.criticality === 'HIGH' ? 1 : asset.criticality === 'MEDIUM' ? 0.86 : 0.72

const pointOn = (x: number, y: number, angle: number, radius: number, squash = 1) => ({
  x: x + Math.cos(angle) * radius,
  y: y + Math.sin(angle) * radius * squash,
})

const fmtEpss = (epss: number | null) => (epss == null ? '—' : `${(epss * 100).toFixed(1)}%`)

function buildNodes(assets: Asset[]): AssetNode[] {
  const nodes: AssetNode[] = []
  for (const def of PLACEMENTS) {
    const asset = assets.find((entry) => entry.id === def.id)
    if (!asset) continue
    const angle = (def.angle * Math.PI) / 180
    const isInner = def.ring === 'inner'
    const x = CX + Math.cos(angle) * (isInner ? INNER_RX : OUTER_RX) + Math.sin(def.angle * 2.1) * 5
    const y = CY + Math.sin(angle) * (isInner ? INNER_RY : OUTER_RY) + Math.cos(def.angle * 1.7) * 4
    nodes.push({ asset, def, x, y, scale: scaleFor(asset), angle })
  }
  return nodes
}

function edgeGeometry(node: AssetNode, point: { x: number; y: number }) {
  const angle = Math.atan2(point.y - node.y, point.x - node.x)
  const start = pointOn(node.x, node.y, angle, 42 * node.scale, 0.8)
  const end = pointOn(point.x, point.y, angle + Math.PI, 13, 0.9)
  const mid = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 }
  const bend = 6
  const control = {
    x: mid.x + Math.cos(angle + Math.PI / 2) * bend,
    y: mid.y + Math.sin(angle + Math.PI / 2) * bend,
  }
  const path = `M ${start.x.toFixed(1)} ${start.y.toFixed(1)} Q ${control.x.toFixed(1)} ${control.y.toFixed(1)} ${end.x.toFixed(1)} ${end.y.toFixed(1)}`
  return { path, start, end }
}

function buildMarkers(nodes: AssetNode[], alerts: Alert[]): MarkerNode[] {
  const byAsset = new Map<string, AssetNode>()
  nodes.forEach((node) => byAsset.set(node.asset.id, node))

  const grouped = new Map<string, Map<string, Alert[]>>()
  for (const alert of alerts) {
    const byCve = grouped.get(alert.asset.id) ?? new Map<string, Alert[]>()
    const list = byCve.get(alert.cve.id) ?? []
    list.push(alert)
    byCve.set(alert.cve.id, list)
    grouped.set(alert.asset.id, byCve)
  }

  const markers: MarkerNode[] = []
  grouped.forEach((byCve, assetId) => {
    const node = byAsset.get(assetId)
    if (!node) return
    const groups = [...byCve.values()]
    groups.forEach((group, index) => {
      const baseDir = node.def.ring === 'inner' ? node.angle : node.angle + Math.PI
      const fan = groups.length > 1 ? (index - (groups.length - 1) / 2) * 0.42 : 0
      const dir = baseDir + fan
      const dist = 96 + node.scale * 22
      const point = pointOn(node.x, node.y, dir, dist, 0.82)
      const ordered = sortAlerts(group)
      markers.push({
        key: `${assetId}:${ordered[0].cve.id}`,
        cve: ordered[0].cve,
        alerts: ordered,
        primary: ordered[0],
        node,
        x: point.x,
        y: point.y,
        ...edgeGeometry(node, point),
      })
    })
  })
  return markers
}

function spokePath(node: AssetNode) {
  const angle = Math.atan2(node.y - CY, node.x - CX)
  const s = pointOn(CX, CY, angle, 104, 0.62)
  const e = pointOn(node.x, node.y, angle + Math.PI, 53 * node.scale, 0.66)
  const mid = { x: (s.x + e.x) / 2, y: (s.y + e.y) / 2 }
  const bend = Math.sin(angle * 2.2) * 9 + 4
  const c = { x: mid.x + Math.cos(angle + Math.PI / 2) * bend, y: mid.y + Math.sin(angle + Math.PI / 2) * bend }
  return `M ${s.x.toFixed(1)} ${s.y.toFixed(1)} Q ${c.x.toFixed(1)} ${c.y.toFixed(1)} ${e.x.toFixed(1)} ${e.y.toFixed(1)}`
}

const particleRand = mulberry32(4471)
const PARTICLES = Array.from({ length: 52 }, (_, i) => ({
  x: 26 + particleRand() * (W - 52),
  y: 30 + particleRand() * (H - 80),
  r: 0.5 + particleRand() * 1.3,
  plus: i % 9 === 0,
  delay: (particleRand() * 7).toFixed(2),
  duration: (4.5 + particleRand() * 5).toFixed(2),
  opacity: 0.2 + particleRand() * 0.5,
}))

const ringRand = mulberry32(991)
const TICKS = Array.from({ length: 40 }, (_, i) => {
  const a = (i / 40) * Math.PI * 2
  const long = i % 5 === 0
  const r1 = long ? 464 : 472
  return {
    x1: CX + Math.cos(a) * r1,
    y1: CY + Math.sin(a) * r1 * 0.52,
    x2: CX + Math.cos(a) * 478,
    y2: CY + Math.sin(a) * 478 * 0.52,
    o: long ? 0.35 : 0.15 + ringRand() * 0.1,
  }
})

const UNLINKED_POS = [
  { x: 986, y: 686 },
  { x: 1014, y: 703 },
  { x: 958, y: 703 },
]

export interface IsoGraphProps {
  alerts: Alert[]
  assets: Asset[]
  cves: Cve[]
  query: string
  hover: string | null
  selected: string
  liveLabel?: string
  allAlerts?: Alert[]
  onHover: (id: string | null) => void
  onSelect: (id: string) => void
}

export function IsoGraph({
  alerts,
  assets,
  cves,
  query,
  hover,
  selected,
  liveLabel,
  allAlerts,
  onHover,
  onSelect,
}: IsoGraphProps) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const tipRef = useRef<HTMLDivElement>(null)
  const [tip, setTip] = useState<TipData | null>(null)

  const nodes = useMemo(() => buildNodes(assets), [assets])
  const markers = useMemo(() => buildMarkers(nodes, alerts), [nodes, alerts])

  const activeByAsset = useMemo(() => {
    const map = new Map<string, Alert[]>()
    for (const alert of alerts) {
      if (alert.suppressed) continue
      const list = map.get(alert.asset.id) ?? []
      list.push(alert)
      map.set(alert.asset.id, list)
    }
    return map
  }, [alerts])

  const linkedCveIds = useMemo(() => new Set((allAlerts ?? alerts).map((alert) => alert.cve.id)), [alerts, allAlerts])
  const unlinked = useMemo(() => cves.filter((cve) => !linkedCveIds.has(cve.id)), [cves, linkedCveIds])

  const assetIds = useMemo(() => new Set(nodes.map((node) => node.asset.id)), [nodes])
  const focus = hover ?? selected
  const hubFocus = focus === 'hub' || focus === ''
  const focusIsAsset = assetIds.has(focus)
  const focusAlerts = hubFocus
    ? alerts
    : focusIsAsset
      ? alerts.filter((alert) => alert.asset.id === focus)
      : alerts.filter((alert) => alert.cve.id === focus)
  const focusAlertKeys = new Set(focusAlerts.map((alert) => `${alert.asset.id}:${alert.cve.id}`))
  const focusAssetIds = new Set(focusAlerts.map((alert) => alert.asset.id))
  if (focusIsAsset) focusAssetIds.add(focus)

  const q = query.trim().toLowerCase()
  const assetMatches = (node: AssetNode) =>
    !q || [node.asset.name, node.asset.id, node.asset.type, node.asset.department].some((value) => value.toLowerCase().includes(q))
  const markerMatches = (marker: MarkerNode) =>
    !q ||
    [
      marker.cve.id,
      marker.cve.title,
      marker.cve.product,
      marker.cve.vendor,
      marker.node.asset.name,
      marker.node.asset.department,
    ].some((value) => value.toLowerCase().includes(q))

  const queryAssetIds = new Set(markers.filter(markerMatches).map((marker) => marker.node.asset.id))
  const assetLit = (node: AssetNode) =>
    hubFocus
      ? assetMatches(node) || queryAssetIds.has(node.asset.id)
      : focusAssetIds.has(node.asset.id) && assetMatches(node)
  const markerLit = (marker: MarkerNode) => {
    if (!markerMatches(marker)) return false
    if (hubFocus) return true
    return focusAlertKeys.has(marker.key)
  }
  const markerActive = (marker: MarkerNode) => selected === marker.cve.id || hover === marker.cve.id

  const backNodes = nodes.filter((node) => node.y < CY + 26)
  const frontNodes = nodes.filter((node) => node.y >= CY + 26)

  const positionTip = (clientX: number, clientY: number) => {
    const wrap = wrapRef.current
    const tipEl = tipRef.current
    if (!wrap || !tipEl) return
    const rect = wrap.getBoundingClientRect()
    let x = clientX - rect.left + 16
    let y = clientY - rect.top + 18
    if (x + tipEl.offsetWidth > rect.width - 12) x = clientX - rect.left - tipEl.offsetWidth - 16
    if (y + tipEl.offsetHeight > rect.height - 12) y = clientY - rect.top - tipEl.offsetHeight - 14
    tipEl.style.transform = `translate3d(${Math.max(8, x)}px, ${Math.max(8, y)}px, 0)`
  }

  const handleMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const el = wrapRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const px = (e.clientX - r.left) / r.width
    const py = (e.clientY - r.top) / r.height
    el.style.setProperty('--px', ((px - 0.5) * 2).toFixed(3))
    el.style.setProperty('--py', ((py - 0.5) * 2).toFixed(3))
    el.style.setProperty('--lx', `${(px * 100).toFixed(1)}%`)
    el.style.setProperty('--ly', `${(py * 100).toFixed(1)}%`)
    if (tip) positionTip(e.clientX, e.clientY)
  }

  const handleLeave = () => {
    const el = wrapRef.current
    if (el) {
      el.style.setProperty('--px', '0')
      el.style.setProperty('--py', '0')
    }
    setTip(null)
    onHover(null)
  }

  const showTip = (e: React.MouseEvent, data: TipData, id: string) => {
    onHover(id)
    setTip(data)
    requestAnimationFrame(() => positionTip(e.clientX, e.clientY))
  }

  const hideTip = () => {
    setTip(null)
    onHover(null)
  }

  const assetTip = (node: AssetNode): TipData => {
    const hazards = activeByAsset.get(node.asset.id) ?? []
    const worst = worstLevel(hazards)
    return {
      kicker: `SIMULATED ASSET · ${node.asset.id}`,
      title: node.asset.name,
      tone: worst ? EDGE_COLORS[worst] : '#5ef5e2',
      rows: [
        { label: 'Department', value: node.asset.department },
        { label: 'Criticality', value: node.asset.criticality },
        { label: 'Exposure', value: node.asset.internetFacing ? 'Internet-facing' : 'Internal' },
        { label: 'Active hazards', value: String(hazards.length) },
      ],
      note: `${node.asset.software.length} packages · ${node.asset.businessFunction}`,
    }
  }

  const markerTip = (marker: MarkerNode): TipData => {
    const color = marker.primary.suppressed ? SUPPRESSED_COLOR : EDGE_COLORS[marker.primary.level]
    return {
      kicker: `CVE NODE · ${marker.cve.vendor.toUpperCase()} ${marker.cve.product.toUpperCase()}`,
      title: marker.cve.id,
      tone: color,
      rows: [
        { label: 'Risk', value: marker.primary.suppressed ? 'Suppressed' : `${marker.primary.level} · ${marker.primary.score.toFixed(1)}` },
        { label: 'CVSS', value: marker.cve.cvss?.toFixed(1) ?? '—' },
        { label: 'EPSS', value: fmtEpss(marker.cve.epss) },
        { label: 'Asset', value: marker.node.asset.name },
      ],
      note: `${marker.alerts.length} correlation record${marker.alerts.length === 1 ? '' : 's'} · ${marker.cve.title}`,
    }
  }

  const press = (id: string) => (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onSelect(id)
    }
  }

  const renderAsset = (node: AssetNode, i: number) => {
    const lit = assetLit(node)
    const active = selected === node.asset.id || hover === node.asset.id
    const t = TONES[node.def.tone]
    const labelY = ((72 * node.scale) * 0.46) / 2 + 22
    const hazards = activeByAsset.get(node.asset.id) ?? []
    const worst = worstLevel(hazards)
    return (
      <g
        key={node.asset.id}
        className={cx('iso-node', !lit && 'is-dim', active && 'is-active', !hubFocus && lit && !active && 'is-linked')}
        transform={`translate(${node.x.toFixed(1)} ${node.y.toFixed(1)})`}
        onMouseEnter={(e) => showTip(e, assetTip(node), node.asset.id)}
        onMouseLeave={hideTip}
        onClick={() => onSelect(node.asset.id)}
        onKeyDown={press(node.asset.id)}
        tabIndex={0}
        role="button"
        aria-label={`${node.asset.name}, ${node.asset.criticality} criticality${hazards.length ? `, ${hazards.length} active hazards` : ''}`}
        style={{ animationDelay: `${(i % 6) * 0.35}s` }}
      >
        <ellipse cx={0} cy={-46} rx={58 * node.scale} ry={82 * node.scale} fill="transparent" />
        <g transform={`scale(${node.scale})`}>
          <g className="iso-plate-shift">
            <IsoPlatform width={112} tone={node.def.tone} active={active} />
          </g>
          <g className="iso-float" style={{ animationDelay: `${(i % 7) * 0.55}s` }}>
            <AssetGlyph glyph={node.def.glyph} tone={node.def.tone} />
          </g>
        </g>
        <text x={0} y={labelY} textAnchor="middle" className="iso-node-label">
          {node.asset.name}
        </text>
        {worst && (
          <g transform={`translate(0 ${labelY + 11})`} opacity={lit ? 0.9 : 0.3}>
            <rect
              x={-20}
              y={-4}
              width={40}
              height={7.5}
              rx={3.75}
              fill={hexA(EDGE_COLORS[worst], 0.12)}
              stroke={hexA(EDGE_COLORS[worst], 0.32)}
              strokeWidth={0.5}
            />
            <circle cx={-13} cy={-0.2} r={1.4} fill={EDGE_COLORS[worst]} />
            <text x={3} y={1.6} textAnchor="middle" className="iso-node-risk" fill={EDGE_COLORS[worst]}>
              {hazards.length} RISK
            </text>
          </g>
        )}
        {active && (
          <circle
            cx={0}
            cy={-52 * node.scale}
            r={52 * node.scale}
            fill="none"
            stroke={hexA(t.line, 0.35)}
            strokeWidth={0.8}
            strokeDasharray="2 5"
          />
        )}
      </g>
    )
  }

  return (
    <div
      ref={wrapRef}
      className="iso-graph"
      onPointerMove={handleMove}
      onPointerLeave={handleLeave}
    >
      <div className="iso-graph-bg" aria-hidden="true" />
      <div className="iso-graph-aura" aria-hidden="true" />
      <div className="iso-graph-light" aria-hidden="true" />
      <svg
        className="iso-svg"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label="Isometric exposure mesh: assets, live CVE nodes and version-gated correlation edges"
      >
        <defs>
          <IsoGradientDefs />
        </defs>

        <g className="iso-parallax">
          <ellipse cx={CX} cy={CY + 30} rx={505} ry={238} fill="url(#iso-hub-floor)" opacity={0.34} />
          <ellipse cx={CX} cy={CY + 22} rx={478} ry={250} fill="none" stroke="rgba(94,245,226,0.06)" strokeWidth={0.8} strokeDasharray="1 8" />
          <ellipse cx={CX} cy={CY + 22} rx={392} ry={205} fill="none" stroke="rgba(94,245,226,0.055)" strokeWidth={0.8} strokeDasharray="1 9" />
          <ellipse cx={CX} cy={CY + 22} rx={304} ry={159} fill="none" stroke="rgba(94,245,226,0.05)" strokeWidth={0.8} strokeDasharray="1 10" />
          <g stroke="rgba(94,245,226,0.16)" strokeWidth={0.8}>
            {TICKS.map((tick, i) => (
              <line key={i} x1={tick.x1} y1={tick.y1} x2={tick.x2} y2={tick.y2} opacity={tick.o} />
            ))}
          </g>
          {PARTICLES.map((p, i) =>
            p.plus ? (
              <g key={i} className="iso-particle" style={{ animationDelay: `${p.delay}s`, animationDuration: `${p.duration}s` }} opacity={p.opacity}>
                <path d={`M ${p.x - 2.4} ${p.y} H ${p.x + 2.4} M ${p.x} ${p.y - 2.4} V ${p.y + 2.4}`} stroke="#7cf5e6" strokeWidth={0.7} />
              </g>
            ) : (
              <circle
                key={i}
                className="iso-particle"
                cx={p.x}
                cy={p.y}
                r={p.r}
                fill={i % 5 === 0 ? '#b9a2ff' : '#7cf5e6'}
                opacity={p.opacity}
                style={{ animationDelay: `${p.delay}s`, animationDuration: `${p.duration}s` }}
              />
            ),
          )}
        </g>

        <g className="iso-spokes">
          {nodes.map((node) => (
            <path
              key={`spoke-${node.asset.id}`}
              d={spokePath(node)}
              pathLength={100}
              fill="none"
              stroke="#3ed2c1"
              strokeWidth={assetLit(node) ? 0.95 : 0.65}
              opacity={hubFocus ? 0.3 : assetLit(node) ? 0.62 : 0.1}
              strokeDasharray="1.2 2.6"
              className="iso-spoke-flow"
            />
          ))}
        </g>

        <g className="iso-alert-links">
          {markers.map((marker) => {
            const color = marker.primary.suppressed ? SUPPRESSED_COLOR : EDGE_COLORS[marker.primary.level]
            const related = markerLit(marker)
            const strong = related && !hubFocus
            const opacity = marker.primary.suppressed
              ? (strong ? 0.58 : related ? 0.34 : 0.12)
              : strong ? 1 : related ? 0.62 : 0.22
            return (
              <g key={`edge-${marker.key}`}>
                <path
                  d={marker.path}
                  pathLength={100}
                  fill="none"
                  stroke={color}
                  strokeWidth={strong ? 2.1 : related ? 1.3 : 0.95}
                  opacity={opacity}
                  strokeDasharray={marker.primary.suppressed ? '2 5' : '4 4'}
                  strokeLinecap="round"
                  className={strong ? 'iso-alert-flow' : undefined}
                />
                <circle cx={marker.start.x} cy={marker.start.y} r={1.7} fill={color} opacity={strong ? 0.95 : related ? 0.6 : 0.24} />
                <circle cx={marker.end.x} cy={marker.end.y} r={2.1} fill={color} opacity={strong ? 0.95 : related ? 0.6 : 0.28} />
              </g>
            )
          })}
        </g>

        {backNodes.map((node, i) => renderAsset(node, i))}

        <g
          className={cx('iso-hub', selected === 'hub' || hover === 'hub' ? 'is-active' : undefined)}
          onMouseEnter={(e) =>
            showTip(
              e,
              {
                kicker: 'CORRELATION CORE',
                title: 'AEGIS exposure mesh',
                tone: '#5ef5e2',
                rows: [
                  { label: 'Assets', value: String(assets.length) },
                  { label: 'CVE records', value: String(cves.length) },
                  { label: 'Active paths', value: String(alerts.filter((alert) => !alert.suppressed).length) },
                  { label: 'Suppressed', value: String(alerts.filter((alert) => alert.suppressed).length) },
                ],
                note: 'Version-gated correlation · NVD, CISA KEV and FIRST EPSS enrichment',
              },
              'hub',
            )
          }
          onMouseLeave={hideTip}
          onClick={() => onSelect('hub')}
          onKeyDown={press('hub')}
          tabIndex={0}
          role="button"
          aria-label="AEGIS correlation core"
        >
          <circle cx={CX} cy={CY - 30} r={132} fill="transparent" />
          <g transform={`translate(${CX} ${CY})`}>
            <HubCore />
          </g>
        </g>

        {frontNodes.map((node, i) => renderAsset(node, i + backNodes.length))}

        <g className="iso-hazards">
          {markers.map((marker) => {
            const color = marker.primary.suppressed ? SUPPRESSED_COLOR : EDGE_COLORS[marker.primary.level]
            const lit = markerLit(marker)
            const active = markerActive(marker)
            return (
              <g
                key={marker.key}
                transform={`translate(${marker.x.toFixed(1)} ${marker.y.toFixed(1)})`}
                className={cx(
                  'iso-hazard',
                  !lit && 'is-dim',
                  active && 'is-active',
                  !hubFocus && lit && 'is-labelled',
                  marker.primary.level === 'CRITICAL' && !marker.primary.suppressed && 'is-critical',
                )}
                onMouseEnter={(e) => showTip(e, markerTip(marker), marker.cve.id)}
                onMouseLeave={hideTip}
                onClick={() => onSelect(marker.cve.id)}
                onKeyDown={press(marker.cve.id)}
                tabIndex={0}
                role="button"
                aria-label={`${marker.cve.id}, ${marker.primary.suppressed ? 'suppressed' : marker.primary.level}, on ${marker.node.asset.name}`}
              >
                <circle r={30} fill="transparent" />
                <HazardMarker level={marker.primary.level} suppressed={marker.primary.suppressed} active={active} />
                <g className="iso-marker-label" transform="translate(0 -56)">
                  <rect
                    x={-51}
                    y={-10}
                    width={102}
                    height={18}
                    rx={9}
                    fill="rgba(3,9,15,0.94)"
                    stroke={hexA(color, 0.5)}
                    strokeWidth={0.8}
                  />
                  <circle cx={-41} cy={-1} r={2.2} fill={color} />
                  <text x={4} y={1.4} textAnchor="middle" className="iso-marker-text" fill="#dce8f2">
                    {marker.cve.id}
                  </text>
                  {marker.primary.suppressed && (
                    <text x={-41} y={7} textAnchor="middle" className="iso-marker-sub" fill={SUPPRESSED_COLOR}>
                      SUP
                    </text>
                  )}
                </g>
              </g>
            )
          })}
        </g>

        {unlinked.length > 0 && (
          <g className="iso-unlinked">
            <text x={994} y={735} textAnchor="middle" className="iso-unlinked-label">
              {unlinked.length} UNLINKED CVE{unlinked.length === 1 ? '' : 'S'}
            </text>
            {unlinked.slice(0, 3).map((cve, i) => {
              const pos = UNLINKED_POS[i] ?? UNLINKED_POS[0]
              const active = selected === cve.id || hover === cve.id
              return (
                <g
                  key={cve.id}
                  transform={`translate(${pos.x} ${pos.y})`}
                  className={cx('iso-shard', active && 'is-active')}
                  onMouseEnter={(e) =>
                    showTip(
                      e,
                      {
                        kicker: 'UNLINKED CVE',
                        title: cve.id,
                        tone: '#ff5f6d',
                        rows: [
                          { label: 'CVSS', value: cve.cvss?.toFixed(1) ?? '—' },
                          { label: 'EPSS', value: fmtEpss(cve.epss) },
                          { label: 'KEV', value: cve.kev ? 'Listed' : 'Not listed' },
                        ],
                        note: 'No inventory hit · drawn as a shard, not a hazard',
                      },
                      cve.id,
                    )
                  }
                  onMouseLeave={hideTip}
                  onClick={() => onSelect(cve.id)}
                  onKeyDown={press(cve.id)}
                  tabIndex={0}
                  role="button"
                  aria-label={`${cve.id}, no inventory hit`}
                >
                  <circle r={18} fill="transparent" />
                  <ellipse className="iso-warn-pulse" cx={0} cy={0} r={10} fill="none" stroke="#ff5f6d" strokeWidth={0.8} opacity={0.3} />
                  <path d="M 0 -8 L 7 0 L 0 8 L -7 0 Z" fill="#230a10" stroke="#ff5f6d" strokeWidth={0.9} opacity={0.9} />
                  <path d="M 0 -8 L 0 8 M -7 0 L 7 0" stroke="#ff8a94" strokeWidth={0.5} opacity={0.7} />
                  <g className="iso-marker-label" transform="translate(0 -24)">
                    <rect x={-54} y={-10} width={108} height={18} rx={9} fill="rgba(3,9,15,0.94)" stroke="rgba(255,95,109,0.4)" strokeWidth={0.8} />
                    <text x={0} y={1.6} textAnchor="middle" className="iso-marker-text" fill="#e8d6d9">
                      {cve.id} · unlinked
                    </text>
                  </g>
                </g>
              )
            })}
          </g>
        )}
      </svg>

      <div className="iso-scan" aria-hidden="true" />
      <div className="iso-frame" aria-hidden="true" />
      <div className="iso-graph-vignette" aria-hidden="true" />

      <div className="iso-hud iso-hud-tl" aria-hidden="true">
        <span className="iso-live">
          <i /> {liveLabel ?? 'live mesh'}
        </span>
        <span className="iso-hud-meta">AEGIS / CORRELATION CORE · NVD · CISA KEV · FIRST EPSS</span>
        <div className="iso-legend">
          <span className="iso-legend-item">
            <i className="iso-key iso-key-node" /> asset node
          </span>
          <span className="iso-legend-item">
            <i className="iso-key iso-key-hazard" /> cve node
          </span>
          <span className="iso-legend-item">
            <i className="iso-key iso-key-flow" /> correlation edge
          </span>
          <span className="iso-legend-item">
            <i className="iso-key iso-key-muted" /> suppressed
          </span>
        </div>
      </div>

      <div className="iso-hud iso-hud-tr" aria-hidden="true">
        <div className="iso-hud-stats">
          <span><b>{nodes.length}</b> assets</span>
          <span><b>{cves.length}</b> cves</span>
          <span><b>{alerts.length}</b> paths</span>
        </div>
        <div className="iso-hud-sub">
          {alerts.filter((alert) => alert.suppressed).length} suppressed · {alerts.filter((alert) => !alert.suppressed).length} active
        </div>
      </div>

      <div className="iso-graph-hint" aria-hidden="true">
        hover to trace · click a node to open its workbench
      </div>

      {tip && (
        <div ref={tipRef} className="iso-tip" style={{ '--tip-tone': tip.tone } as CSSProperties} role="tooltip">
          <div className="iso-tip-kicker">{tip.kicker}</div>
          <div className="iso-tip-title">{tip.title}</div>
          <div className="iso-tip-rows">
            {tip.rows.map((row) => (
              <div className="iso-tip-row" key={row.label}>
                <span>{row.label}</span>
                <b>{row.value}</b>
              </div>
            ))}
          </div>
          {tip.note && <div className="iso-tip-note">{tip.note}</div>}
          <div className="iso-tip-foot">
            <span>Open analysis workbench</span>
            <ArrowRight size={10} />
          </div>
        </div>
      )}
    </div>
  )
}
