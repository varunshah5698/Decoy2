import { useMemo, useState } from 'react'
import type { Alert } from '../lib/types'
import { cx, fmtDate, fmtScore } from '../lib/format'
import { relevanceLabel } from '../lib/scoring'

export type Truth = 'public' | 'simulated' | 'gap'

export interface EvSegment {
  label: string
  share: number
  tone: 'accent' | 'navy' | 'mid'
}

export interface EvNode {
  id: string
  lane: number
  kind: string
  title: string
  detail: string
  value: string
  truth: Truth
  note: string
  badge?: string
  badgeTone?: 'good' | 'bad' | 'neutral'
  segments?: EvSegment[]
}

export interface EvEdge {
  from: string
  to: string
}

export const EV_LANES = [
  { key: 'source', label: 'SOURCE', column: 'RECORDED BY' },
  { key: 'intelligence', label: 'INTELLIGENCE', column: 'INTELLIGENCE' },
  { key: 'rule', label: 'RULE', column: 'RULE' },
  { key: 'warning', label: 'WARNING', column: 'WARNING' },
  { key: 'inventory', label: 'INVENTORY', column: 'INVENTORY' },
] as const

const NODE_W = 188
const NODE_H = 64
const GAP_X = 36
const GAP_Y = 14
const PAD_X = 12
const HEADER_Y = 34
const BAND_Y = 16
const TOP_Y = 96
const SPAN = 4 * NODE_H + 3 * GAP_Y
const CANVAS_W = PAD_X * 2 + EV_LANES.length * NODE_W + (EV_LANES.length - 1) * GAP_X
const CANVAS_H = TOP_Y + SPAN + 22
/** A hover card needs ~150px of clearance; nodes nearer the top flip theirs downwards. */
const TIP_MIN_Y = 150
/** Width of .evc-tip — cards in the last lane hang left so they stay inside the canvas. */
const TIP_W = 236

const pct = (n: number) => `${Math.round(n * 100)}%`

export function buildEvidenceGraph(alert: Alert): { nodes: EvNode[]; edges: EvEdge[] } {
  const { cve, asset, breakdown: b } = alert
  const epssKnown = cve.epss != null
  const rangeKnown = Boolean(cve.range.endExcluding || cve.range.endIncluding)
  const versionKnown = alert.version !== 'unknown' && alert.version !== 'not installed'

  const total = Math.max(1, b.total_raw)
  const scoreSegments: EvSegment[] = [
    { label: 'Severity', share: b.severity_points / total, tone: 'accent' },
    { label: 'Exploit', share: b.exploit_points / total, tone: 'navy' },
    { label: 'KEV', share: b.kev_points / total, tone: 'mid' },
    { label: 'Criticality', share: b.criticality_points / total, tone: 'accent' },
    { label: 'Exposure', share: b.exposure_points / total, tone: 'navy' },
    { label: 'Relevance', share: b.relevance_points / total, tone: 'mid' },
  ]

  const nodes: EvNode[] = [
    {
      id: 'src-kev',
      lane: 0,
      kind: 'SOURCE',
      title: 'CISA KEV',
      detail: cve.kev ? `Listed · due ${fmtDate(cve.kevDue ?? cve.modified)}` : 'Not in the exploited catalog',
      value: cve.kev ? 'Listed' : 'Not listed',
      truth: cve.kev ? 'public' : 'gap',
      badge: cve.kev ? '+ KEV' : 'no KEV',
      badgeTone: cve.kev ? 'good' : 'neutral',
      note: 'The catalog row is read as a boolean. Absence is recorded as absent, never as zero risk.',
      segments: [{ label: cve.kev ? 'Listed' : 'Absent', share: 1, tone: cve.kev ? 'accent' : 'mid' }],
    },
    {
      id: 'src-nvd',
      lane: 0,
      kind: 'EVIDENCE',
      title: 'NVD record',
      detail: `${cve.id} · rev ${fmtDate(cve.modified)}`,
      value: cve.cvss == null ? 'CVSS missing' : `CVSS ${cve.cvss.toFixed(1)}`,
      truth: cve.cvss == null ? 'gap' : 'public',
      badge: cve.cvss == null ? 'gap' : 'fetched',
      badgeTone: cve.cvss == null ? 'bad' : 'good',
      note: 'Public advisory record: vector, weaknesses, references and the CPE configurations that bound the range.',
    },
    {
      id: 'src-rule',
      lane: 0,
      kind: 'EVIDENCE',
      title: 'Detection rule',
      detail: `Version gate · formula v${b.formula_version}`,
      value: `v${b.formula_version}`,
      truth: 'public',
      badge: 'deterministic',
      badgeTone: 'good',
      note: 'Fixed comparison rules decide relevance. No model is consulted on this path.',
    },
    {
      id: 'src-prov',
      lane: 0,
      kind: 'EVIDENCE',
      title: 'Data provenance',
      detail: `${asset.source} inventory · ${asset.id}`,
      value: asset.source,
      truth: asset.source === 'SIMULATED' ? 'simulated' : 'public',
      badge: asset.source === 'SIMULATED' ? 'SIM' : 'upload',
      badgeTone: asset.source === 'SIMULATED' ? 'neutral' : 'good',
      note: 'Every stored row carries who produced it. Demo inventory is labelled SIMULATED end to end.',
    },
    {
      id: 'vuln',
      lane: 1,
      kind: 'VULNERABILITY',
      title: cve.id,
      detail: `${cve.vendor} ${cve.product}`,
      value: cve.cvss == null ? 'no CVSS' : `CVSS ${cve.cvss.toFixed(1)} · ${cve.severity}`,
      truth: cve.cvss == null ? 'gap' : 'public',
      note: 'The normalised vulnerability node: identity, affected range and severity, held separately from any asset.',
      segments: [{ label: rangeKnown ? 'Range bounded' : 'Range open', share: 1, tone: rangeKnown ? 'navy' : 'mid' }],
    },
    {
      id: 'exploit',
      lane: 1,
      kind: 'THREAT',
      title: 'Exploit signal',
      detail: cve.title.length > 40 ? `${cve.title.slice(0, 40)}…` : cve.title,
      value: epssKnown ? `${pct(cve.epss!)} likelihood` : 'EPSS missing',
      truth: epssKnown ? 'public' : 'gap',
      badge: epssKnown ? `${pct(cve.epss!)}` : 'missing',
      badgeTone: epssKnown ? 'good' : 'bad',
      note: 'Likelihood of exploitation in the wild, joined from FIRST EPSS and CISA KEV. This is what separates a 9.8 on paper from a 9.8 on your network.',
      segments: [
        { label: 'Exploited', share: cve.kev ? 0.62 : 0.18, tone: 'accent' },
        { label: 'Theoretical', share: cve.kev ? 0.38 : 0.82, tone: 'mid' },
      ],
    },
    {
      id: 'gate',
      lane: 2,
      kind: 'RULE',
      title: 'Version gate',
      detail: `${alert.relevance} · ${relevanceLabel[alert.relevance]}`,
      value: alert.relevance,
      truth: 'public',
      badge: alert.suppressed ? 'suppressed' : 'survived',
      badgeTone: alert.suppressed ? 'bad' : 'good',
      note: 'Installed version is compared against the affected range. A suppressed record stays on screen with its reason attached.',
      segments: [
        { label: alert.relevance, share: 1, tone: alert.suppressed ? 'mid' : 'accent' },
      ],
    },
    {
      id: 'formula',
      lane: 2,
      kind: 'RULE',
      title: `Formula v${b.formula_version}`,
      detail: 'six factors · fixed weights',
      value: `${fmtScore(alert.score)} / 100`,
      truth: 'public',
      note: 'The weighted sum below is recomputed from the stored breakdown on every render, so the number and its parts cannot drift apart.',
      segments: scoreSegments,
    },
    {
      id: 'alert',
      lane: 3,
      kind: 'ALERT',
      title: alert.id,
      detail: `${alert.level} · ${asset.name}`,
      value: `${fmtScore(alert.score)} · ${alert.level}`,
      truth: alert.suppressed ? 'gap' : 'public',
      badge: alert.suppressed ? 'suppressed' : alert.level,
      badgeTone: alert.suppressed ? 'neutral' : alert.level === 'CRITICAL' || alert.level === 'HIGH' ? 'bad' : 'good',
      note: 'The published record. It is the only node downstream consumers read, and every field in it traces back to a node on this canvas.',
      segments: scoreSegments,
    },
    {
      id: 'writer',
      lane: 3,
      kind: 'NOTE',
      title: 'Analyst summary',
      detail: `written by ${alert.generatedBy === 'llm' ? 'language model' : 'template writer'}`,
      value: alert.generatedBy,
      truth: 'simulated',
      badge: 'text only',
      badgeTone: 'neutral',
      note: 'Prose is the only thing the language layer may produce. It cannot move score, level, relevance or suppression.',
    },
    {
      id: 'asset',
      lane: 4,
      kind: 'ASSET',
      title: asset.name,
      detail: `${asset.id} · ${asset.department}`,
      value: `${asset.criticality} criticality`,
      truth: asset.source === 'SIMULATED' ? 'simulated' : 'public',
      badge: asset.internetFacing ? 'internet' : 'internal',
      badgeTone: asset.internetFacing ? 'bad' : 'neutral',
      note: 'The system the alert was matched against, with the business context that weights its score.',
    },
    {
      id: 'software',
      lane: 4,
      kind: 'HOST',
      title: `${cve.product}`,
      detail: `installed ${alert.version}`,
      value: alert.version,
      truth: versionKnown ? (asset.source === 'SIMULATED' ? 'simulated' : 'public') : 'gap',
      badge: versionKnown ? 'versioned' : 'unknown',
      badgeTone: versionKnown ? 'good' : 'bad',
      note: 'The exact build on the host. Unknown versions are what let a CVSS 9.8 become noise.',
    },
  ]

  const edges: EvEdge[] = [
    { from: 'src-nvd', to: 'vuln' },
    { from: 'src-kev', to: 'exploit' },
    { from: 'src-rule', to: 'exploit' },
    { from: 'src-prov', to: 'exploit' },
    { from: 'vuln', to: 'gate' },
    { from: 'exploit', to: 'gate' },
    { from: 'gate', to: 'alert' },
    { from: 'formula', to: 'alert' },
    { from: 'gate', to: 'writer' },
    { from: 'alert', to: 'asset' },
    { from: 'alert', to: 'software' },
  ]

  return { nodes, edges }
}

/** Column slots follow the lane's node count so the fan-in and fan-out stay symmetric. */
function layout(nodes: EvNode[]) {
  const byLane = new Map<number, EvNode[]>()
  nodes.forEach((n) => {
    const list = byLane.get(n.lane) ?? []
    list.push(n)
    byLane.set(n.lane, list)
  })
  const pos = new Map<string, { x: number; y: number }>()
  byLane.forEach((list, lane) => {
    const block = list.length * NODE_H + (list.length - 1) * GAP_Y
    const startY = TOP_Y + (SPAN - block) / 2
    list.forEach((n, i) => {
      pos.set(n.id, { x: PAD_X + lane * (NODE_W + GAP_X), y: startY + i * (NODE_H + GAP_Y) })
    })
  })
  return pos
}

/** Directed closure: ancestors when dir is 'up', descendants when dir is 'down'. */
const closure = (edges: EvEdge[], id: string, dir: 'up' | 'down') => {
  const found = new Set<string>()
  const queue = [id]
  while (queue.length) {
    const current = queue.shift()!
    for (const e of edges) {
      const next = dir === 'up' ? (e.to === current ? e.from : null) : e.from === current ? e.to : null
      if (next && !found.has(next)) {
        found.add(next)
        queue.push(next)
      }
    }
  }
  return found
}

/** Everything this node actually depends on, plus everything that depends on it. */
const neighbours = (edges: EvEdge[], id: string) =>
  new Set([id, ...closure(edges, id, 'up'), ...closure(edges, id, 'down')])

export function EvidenceChain({
  nodes,
  edges,
  activeId,
  onSelect,
  filter,
}: {
  nodes: EvNode[]
  edges: EvEdge[]
  activeId: string | null
  onSelect: (id: string) => void
  filter: 'all' | Truth
}) {
  const [hoverId, setHoverId] = useState<string | null>(null)
  const focus = hoverId ?? activeId
  const positions = useMemo(() => layout(nodes), [nodes])
  const hotPath = useMemo(() => (focus ? neighbours(edges, focus) : null), [edges, focus])
  /* Dimming is a hover-only affordance: a clicked node keeps its path lit without washing the
     rest of the chain out, so the resting canvas stays readable. */
  const tracePath = useMemo(() => (hoverId ? new Set(neighbours(edges, hoverId)) : null), [edges, hoverId])

  /* A filter that matches nothing must not fade the whole chain out — that reads as a broken
     graph rather than an empty result, so the canvas stays at rest and says why instead. */
  const filterMatches = filter === 'all' || nodes.some((n) => n.truth === filter)
  const isDimmed = (n: EvNode) =>
    (filterMatches && filter !== 'all' && n.truth !== filter) || Boolean(tracePath && !tracePath.has(n.id))

  const edgeState = (e: EvEdge) => {
    if (!focus) return 'idle'
    const touches = e.from === focus || e.to === focus
    if (touches) return 'hot'
    return hotPath?.has(e.from) && hotPath?.has(e.to) ? 'warm' : 'cold'
  }

  return (
    <div className="evc">
      {/* Lane rail — the stage sequence the record travels through. */}
      <div className="evc-rail" aria-hidden="true">
        {EV_LANES.map((l, i) => (
          <span key={l.key} className="evc-rail-step">
            {l.label}
            {i < EV_LANES.length - 1 && <i className="evc-rail-chev">›</i>}
          </span>
        ))}
      </div>

      {!filterMatches && (
        <p className="evc-empty" role="status">
          {filter === 'gap'
            ? 'Nothing is missing — every node in this chain traces back to a record.'
            : `No ${filter} nodes in this chain.`}
        </p>
      )}

      <div className="evc-scroll">
        <div className="evc-canvas" style={{ width: CANVAS_W, height: CANVAS_H }}>
          {EV_LANES.map((l, i) => (
            <span
              key={`band-${l.key}`}
              className="evc-band"
              aria-hidden="true"
              style={{
                left: PAD_X + i * (NODE_W + GAP_X) - 10,
                top: BAND_Y,
                width: NODE_W + 20,
                height: CANVAS_H - BAND_Y - 14,
              }}
            />
          ))}
          {EV_LANES.map((l, i) => (
            <span
              key={l.key}
              className="evc-column"
              style={{ left: PAD_X + i * (NODE_W + GAP_X), width: NODE_W, top: HEADER_Y }}
            >
              {l.column}
            </span>
          ))}

          <svg className="evc-edges" width={CANVAS_W} height={CANVAS_H} aria-hidden="true">
            <defs>
              <marker id="evc-arrow-cold" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M0 0 L8 4 L0 8 z" fill="#c9d1dd" />
              </marker>
              <marker id="evc-arrow-warm" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                <path d="M0 0 L8 4 L0 8 z" fill="#a9b4c6" />
              </marker>
              <marker id="evc-arrow-hot" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M0 0 L8 4 L0 8 z" fill="#f2622e" />
              </marker>
            </defs>
            {edges.map((e) => {
              const a = positions.get(e.from)
              const b = positions.get(e.to)
              if (!a || !b) return null
              const x1 = a.x + NODE_W
              const y1 = a.y + NODE_H / 2
              const x2 = b.x
              const y2 = b.y + NODE_H / 2
              const bend = Math.max(30, (x2 - x1) * 0.45)
              const state = edgeState(e)
              return (
                <path
                  key={`${e.from}-${e.to}`}
                  className={cx('evc-edge', `is-${state}`)}
                  d={`M${x1} ${y1} C${x1 + bend} ${y1} ${x2 - bend} ${y2} ${x2} ${y2}`}
                  markerEnd={`url(#evc-arrow-${state === 'idle' ? 'cold' : state})`}
                />
              )
            })}
          </svg>

          {nodes.map((n) => {
            const p = positions.get(n.id)
            if (!p) return null
            const isActive = activeId === n.id
            const dimmed = isDimmed(n)
            return (
              <button
                type="button"
                key={n.id}
                className={cx(
                  'evc-node',
                  `truth-${n.truth}`,
                  `lane-${EV_LANES[n.lane].key}`,
                  isActive && 'is-active',
                  dimmed && 'is-dim',
                  p.y < TIP_MIN_Y && 'tip-below',
                  p.x + TIP_W > CANVAS_W - PAD_X && 'tip-hang-left'
                )}
                style={{ left: p.x, top: p.y, width: NODE_W, height: NODE_H }}
                onMouseEnter={() => setHoverId(n.id)}
                onMouseLeave={() => setHoverId((cur) => (cur === n.id ? null : cur))}
                onFocus={() => setHoverId(n.id)}
                onBlur={() => setHoverId((cur) => (cur === n.id ? null : cur))}
                onClick={() => onSelect(n.id)}
                aria-pressed={isActive}
              >
                <span className="evc-node-bar" aria-hidden="true" />
                <span className="evc-node-body">
                  <span className="evc-node-top">
                    <span className="evc-node-title">{n.title}</span>
                    <span className="evc-node-kind">{n.kind}</span>
                  </span>
                  <span className="evc-node-detail">{n.detail}</span>
                </span>

                <span className="evc-tip" role="tooltip">
                  <span className="evc-tip-head">
                    <span className="evc-tip-kind">{n.kind}</span>
                    {n.badge && <span className={cx('evc-tip-badge', `tone-${n.badgeTone ?? 'neutral'}`)}>{n.badge}</span>}
                  </span>
                  <span className="evc-tip-value">{n.value}</span>
                  {n.segments && (
                    <>
                      <span className="evc-tip-bar">
                        {n.segments.map((s) => (
                          <i key={s.label} className={`tone-${s.tone}`} style={{ width: `${s.share * 100}%` }} />
                        ))}
                      </span>
                      <span className="evc-tip-legend">
                        {n.segments.slice(0, 3).map((s) => (
                          <span key={s.label}>
                            <i className={`dot tone-${s.tone}`} />
                            {s.label} {Math.round(s.share * 100)}%
                          </span>
                        ))}
                      </span>
                    </>
                  )}
                </span>
              </button>
            )
          })}
        </div>
      </div>

      {/* Narrow screens get the same nodes as a lane-grouped list instead of a scrolling canvas. */}
      <div className="evc-list">
        {EV_LANES.map((l, laneIndex) => (
          <div className="evc-list-lane" key={l.key}>
            <div className="evc-list-label">{l.column}</div>
            {nodes
              .filter((n) => n.lane === laneIndex)
              .map((n) => (
                <button
                  type="button"
                  key={n.id}
                  className={cx('evc-node', 'is-row', `truth-${n.truth}`, activeId === n.id && 'is-active', isDimmed(n) && 'is-dim')}
                  onClick={() => onSelect(n.id)}
                  aria-pressed={activeId === n.id}
                >
                  <span className="evc-node-bar" aria-hidden="true" />
                  <span className="evc-node-body">
                    <span className="evc-node-top">
                      <span className="evc-node-title">{n.title}</span>
                      <span className="evc-node-kind">{n.kind}</span>
                    </span>
                    <span className="evc-node-detail">{n.detail}</span>
                  </span>
                </button>
              ))}
          </div>
        ))}
      </div>
    </div>
  )
}
