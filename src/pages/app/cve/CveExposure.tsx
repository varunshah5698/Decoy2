import { useId, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react'
import { ArrowRight, ExternalLink, X } from '../../../components/Icons'
import { RelevanceBadge, SeverityBadge } from '../../../components/Badges'
import { Waterfall } from '../../../components/Waterfall'
import { LEVEL_COLORS, SUPPRESSED, hexA, levelColor } from '../../../lib/colors'
import { rangeText } from '../../../lib/correlation'
import { clamp, cx, fmtDate, fmtPct, fmtScore } from '../../../lib/format'
import { stageLabel, useCveWorkflow } from './useCveWorkflow'
import type { Alert, Cve, RelevanceStatus } from '../../../lib/types'

const CWE_META: Record<string, { name: string; note: string }> = {
  'CWE-20': {
    name: 'Improper Input Validation',
    note: 'Malformed input reaches sensitive logic without being validated, letting an attacker steer parser state.',
  },
  'CWE-77': {
    name: 'Command Injection',
    note: 'Command arguments accept untrusted input, so crafted values can run outside the intended program.',
  },
  'CWE-78': {
    name: 'OS Command Injection',
    note: 'Shell commands are assembled from untrusted input, giving an attacker a path to code execution.',
  },
  'CWE-89': {
    name: 'SQL Injection',
    note: 'Query text is assembled from unvalidated input, exposing records behind the database.',
  },
  'CWE-94': {
    name: 'Code Injection',
    note: 'Untrusted input is evaluated as code inside the application process.',
  },
  'CWE-119': {
    name: 'Buffer Bounds',
    note: 'Memory operations trust attacker-controlled lengths and can read or write beyond the buffer.',
  },
  'CWE-269': {
    name: 'Improper Privilege Management',
    note: 'A lower-privileged party can gain access reserved for a higher-privileged role.',
  },
  'CWE-287': {
    name: 'Improper Authentication',
    note: 'Identity checks can be bypassed, so a request can act without proving who sent it.',
  },
  'CWE-330': {
    name: 'Insufficient Randomness',
    note: 'Predictable values weaken tokens, identifiers or cryptographic secrets.',
  },
  'CWE-364': {
    name: 'Signal Handler Race',
    note: 'Concurrent signal handling corrupts shared state and can crash or hijack the process.',
  },
  'CWE-400': {
    name: 'Uncontrolled Resource Consumption',
    note: 'Crafted requests exhaust CPU, memory or connections and take the service offline.',
  },
  'CWE-502': {
    name: 'Deserialization of Untrusted Data',
    note: 'Attacker-controlled serialized data is reconstructed as live objects, which can lead to code execution.',
  },
  'CWE-506': {
    name: 'Embedded Malicious Code',
    note: 'The shipped build contains attacker-planted code and cannot be trusted until rebuilt.',
  },
  'CWE-674': {
    name: 'Uncontrolled Recursion',
    note: 'Deep recursion exhausts the call stack and terminates the process.',
  },
  'CWE-787': {
    name: 'Out-of-bounds Write',
    note: 'Writes past a buffer corrupt adjacent memory and are commonly exploited for code execution.',
  },
  'CWE-918': {
    name: 'Server-Side Request Forgery',
    note: 'The server can be steered into fetching internal services that the attacker cannot reach directly.',
  },
}

const cweMeta = (id: string) =>
  CWE_META[id] ?? { name: 'Weakness class', note: 'This weakness class is recorded against the CVE.' }

const REL: Record<RelevanceStatus, { label: string; short: string; tone: string }> = {
  MATCHED: { label: 'Matched', short: 'matched', tone: '#54e6b2' },
  VERSION_UNKNOWN: { label: 'Version unknown', short: 'verify version', tone: '#e3a455' },
  NOT_AFFECTED: { label: 'Not affected', short: 'reviewed out', tone: SUPPRESSED },
  PRODUCT_ABSENT: { label: 'Product absent', short: 'reviewed out', tone: SUPPRESSED },
}

const W = 760
const H = 340
const CY = 200
const CVE_CX = 238
const CVE_R = 52
const ASSET_X = 434
const ASSET_W = 170
const PEER_X = 616
const PEER_W = 128

const clip = (value: string, max: number) => (value.length > max ? `${value.slice(0, max - 1)}…` : value)

const toneFor = (alert: Alert) =>
  alert.suppressed ? SUPPRESSED : alert.relevance === 'MATCHED' ? levelColor(alert.level) : '#e3a455'

const edgeLabel = (alert: Alert) =>
  alert.suppressed ? 'reviewed out' : `${REL[alert.relevance].short} · ${fmtScore(alert.score)}`

type Selection =
  | { kind: 'cve' }
  | { kind: 'asset'; alertId: string }
  | { kind: 'peer'; cveId: string }
  | { kind: 'weakness'; cwe: string }
  | { kind: 'empty' }

interface PeerNode {
  alert: Alert
  cve: Cve
  key: string
  y: number
}

interface AssetNode {
  alert: Alert
  y: number
  peers: PeerNode[]
}

export function CveExposure({
  cve,
  alerts,
  alertsByAsset,
  cves,
  onOpenCve,
  onOpenResponse,
}: {
  cve: Cve
  alerts: Alert[]
  alertsByAsset: Map<string, Alert[]>
  cves: Cve[]
  onOpenCve: (cveId: string) => void
  onOpenResponse: () => void
}) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '')
  const flow = useCveWorkflow((s) => s.flows[cve.id])
  const hasActive = alerts.some((alert) => !alert.suppressed)
  const suppressedCount = alerts.filter((alert) => alert.suppressed).length
  const [showSuppressed, setShowSuppressed] = useState(false)
  const [selected, setSelected] = useState<Selection>({ kind: 'cve' })
  const [hover, setHover] = useState<string | null>(null)

  const visible = hasActive ? (showSuppressed ? alerts : alerts.filter((alert) => !alert.suppressed)) : alerts
  const shown = visible.slice(0, 4)
  const hiddenCount = visible.length - shown.length
  const spacing = shown.length <= 2 ? 80 : shown.length === 3 ? 72 : 64
  const nodes: AssetNode[] = shown.map((alert, index) => {
    const y = CY + (index - (shown.length - 1) / 2) * spacing
    const residents = (alertsByAsset.get(alert.asset.id) ?? [])
      .filter((resident) => resident.cve.id !== cve.id)
      .slice(0, 2)
    return {
      alert,
      y,
      peers: residents.map((peerAlert, peerIndex) => ({
        alert: peerAlert,
        cve: cves.find((entry) => entry.id === peerAlert.cve.id) ?? peerAlert.cve,
        key: `peer:${alert.asset.id}:${peerAlert.cve.id}`,
        y: y + (peerIndex - (residents.length - 1) / 2) * 36,
      })),
    }
  })

  const best = alerts.reduce<Alert | null>((winner, alert) => {
    if (alert.suppressed) return winner
    return !winner || alert.score > winner.score ? alert : winner
  }, null)
  const activeCount = alerts.filter((alert) => !alert.suppressed).length
  const matchedCount = alerts.filter((alert) => !alert.suppressed && alert.relevance === 'MATCHED').length
  const unverifiedCount = alerts.filter(
    (alert) => !alert.suppressed && alert.relevance === 'VERSION_UNKNOWN',
  ).length
  const peerCount = new Set(nodes.flatMap((node) => node.peers.map((peer) => peer.cve.id))).size
  const sevColor = LEVEL_COLORS[cve.severity]

  const lit = new Set<string>()
  if (hover) {
    lit.add(hover)
    if (hover === 'cve') {
      cve.cwe.forEach((weakness) => lit.add(`weak:${weakness}`))
      nodes.forEach((node) => {
        lit.add(`asset:${node.alert.id}`)
        node.peers.forEach((peer) => lit.add(peer.key))
      })
      if (nodes.length === 0) lit.add('empty')
    } else if (hover.startsWith('asset:')) {
      lit.add('cve')
      const node = nodes.find((entry) => `asset:${entry.alert.id}` === hover)
      node?.peers.forEach((peer) => lit.add(peer.key))
    } else if (hover.startsWith('peer:')) {
      const node = nodes.find((entry) => entry.peers.some((peer) => peer.key === hover))
      if (node) lit.add(`asset:${node.alert.id}`)
    } else if (hover.startsWith('weak:')) {
      lit.add('cve')
    } else if (hover === 'empty') {
      lit.add('cve')
    }
  }
  const dimmed = (key: string) => Boolean(hover) && !lit.has(key)
  const dimmedEdge = (left: string, right: string) =>
    Boolean(hover) && !(lit.has(left) && lit.has(right))

  const activate = (key: string, label: string, onActivate: () => void) => ({
    role: 'button' as const,
    tabIndex: 0,
    'aria-label': label,
    onMouseEnter: () => setHover(key),
    onMouseLeave: () => setHover(null),
    onFocus: () => setHover(key),
    onBlur: () => setHover(null),
    onClick: onActivate,
    onKeyDown: (event: KeyboardEvent<SVGGElement>) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        onActivate()
      }
    },
  })

  const cweY = (index: number) => {
    const gap = cve.cwe.length >= 4 ? 42 : cve.cwe.length === 3 ? 48 : 54
    return CY + (index - (cve.cwe.length - 1) / 2) * gap
  }

  const selectedAssetId = selected.kind === 'asset' ? selected.alertId : null
  const selectedPeerId = selected.kind === 'peer' ? selected.cveId : null
  const selectedWeakness = selected.kind === 'weakness' ? selected.cwe : null

  return (
    <div className="cve-ws-exposure">
      <div className="cve-ws-metrics" aria-label="CVE exposure metrics">
        <div className="cve-ws-metric" style={{ '--tone': sevColor } as CSSProperties}>
          <span className="mono">CVSS</span>
          <b>{cve.cvss?.toFixed(1) ?? '—'}</b>
          <span className="cve-ws-metric-note">{cve.severity} band</span>
          <span className="cve-ws-metric-bar">
            <i style={{ width: `${clamp(((cve.cvss ?? 0) / 10) * 100, 0, 100)}%` }} />
          </span>
        </div>
        <div className="cve-ws-metric" style={{ '--tone': '#3ed2c1' } as CSSProperties}>
          <span className="mono">EPSS</span>
          <b>{cve.epss == null ? '—' : fmtPct(cve.epss)}</b>
          <span className="cve-ws-metric-note">
            {cve.epssPercentile == null ? 'no percentile' : `p${Math.round(cve.epssPercentile * 100)} percentile`}
          </span>
          <span className="cve-ws-metric-bar">
            <i style={{ width: `${clamp((cve.epss ?? 0) * 100, 0, 100)}%` }} />
          </span>
        </div>
        <div className="cve-ws-metric" style={{ '--tone': '#e3a455' } as CSSProperties}>
          <span className="mono">KEV</span>
          <b>{cve.kev ? 'Listed' : '—'}</b>
          <span className="cve-ws-metric-note">
            {cve.kev ? (cve.kevDue ? `due ${fmtDate(cve.kevDue)}` : 'CISA KEV listing') : 'not exploited in the wild'}
          </span>
          <span className="cve-ws-metric-bar">
            <i style={{ width: cve.kev ? '100%' : '0%' }} />
          </span>
        </div>
        <div className="cve-ws-metric" style={{ '--tone': '#54e6b2' } as CSSProperties}>
          <span className="mono">Exposed assets</span>
          <b>{activeCount}</b>
          <span className="cve-ws-metric-note">
            {matchedCount} matched · {unverifiedCount} unverified
          </span>
          <span className="cve-ws-metric-bar">
            <i style={{ width: `${activeCount === 0 ? 0 : clamp((matchedCount / Math.max(1, activeCount)) * 100, 8, 100)}%` }} />
          </span>
        </div>
        <div className="cve-ws-metric" style={{ '--tone': '#9b7bd4' } as CSSProperties}>
          <span className="mono">Co-resident</span>
          <b>{peerCount}</b>
          <span className="cve-ws-metric-note">other CVEs on these hosts</span>
          <span className="cve-ws-metric-bar">
            <i style={{ width: peerCount === 0 ? '0%' : `${Math.min(100, peerCount * 33)}%` }} />
          </span>
        </div>
      </div>

      <div className="cve-ws-graph">
        <div className="cve-ws-canvas">
          <div className="cve-ws-canvas-head">
            <div>
              <span className="cve-ws-canvas-title">Blast radius</span>
              <p className="cve-ws-canvas-sub">CVE → asset → co-resident risk. Hover to trace, click to inspect.</p>
            </div>
            <div className="cve-ws-canvas-tools">
              {hasActive && suppressedCount > 0 && (
                <button
                  type="button"
                  className={cx('cve-ws-toggle', showSuppressed && 'on')}
                  aria-pressed={showSuppressed}
                  onClick={() => setShowSuppressed((value) => !value)}
                >
                  <i />
                  Include reviewed out ({suppressedCount})
                </button>
              )}
              {selected.kind !== 'cve' && (
                <button type="button" className="cve-ws-reset" onClick={() => setSelected({ kind: 'cve' })}>
                  <X size={10} /> Reset
                </button>
              )}
            </div>
          </div>

          <div className="cve-ws-canvas-scroll">
          <svg
            className="cve-ws-svg"
            viewBox={`0 0 ${W} ${H}`}
            role="img"
            aria-label={`Exposure graph for ${cve.id}`}
          >
            <defs>
              <radialGradient id={`shine-${uid}`} cx="30%" cy="24%" r="72%">
                <stop offset="0%" stopColor="#ffffff" stopOpacity="0.72" />
                <stop offset="38%" stopColor="#ffffff" stopOpacity="0.1" />
                <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
              </radialGradient>
              <radialGradient id={`shade-${uid}`} cx="76%" cy="82%" r="74%">
                <stop offset="0%" stopColor="#000000" stopOpacity="0.36" />
                <stop offset="62%" stopColor="#000000" stopOpacity="0" />
              </radialGradient>
              <filter id={`glow-${uid}`} x="-70%" y="-70%" width="240%" height="240%">
                <feGaussianBlur stdDeviation="9" />
              </filter>
            </defs>

            <text className="cve-ws-col-label" x={18} y={16}>
              WEAKNESS
            </text>
            <text className="cve-ws-col-label" x={CVE_CX} y={16} textAnchor="middle">
              CVE CORE
            </text>
            <text className="cve-ws-col-label" x={ASSET_X} y={16}>
              CORRELATED ASSETS
            </text>
            {peerCount > 0 && (
              <text className="cve-ws-col-label" x={PEER_X} y={16}>
                CO-RESIDENT
              </text>
            )}

            {cve.cwe.map((weakness, index) => {
              const y = cweY(index)
              return (
                <path
                  key={`weak-edge-${weakness}`}
                  className={cx('cve-ws-edge', dimmedEdge(`weak:${weakness}`, 'cve') && 'is-dim')}
                  d={`M 100 ${y} C 138 ${y}, 148 ${CY}, 186 ${CY}`}
                  stroke="rgba(155,123,212,.32)"
                  strokeWidth={1}
                  strokeDasharray="3 4"
                />
              )
            })}

            {nodes.map((node) => {
              const tone = toneFor(node.alert)
              const startKey = 'cve'
              const endKey = `asset:${node.alert.id}`
              return (
                <g key={`edge-${node.alert.id}`} className={cx('cve-ws-edge-group', dimmedEdge(startKey, endKey) && 'is-dim')}>
                  <path
                    className="cve-ws-edge"
                    d={`M 290 ${CY} C 348 ${CY}, 380 ${node.y}, ${ASSET_X} ${node.y}`}
                    stroke={hexA(tone, 0.55)}
                    strokeWidth={2}
                  />
                  {!node.alert.suppressed && (
                    <path
                      className="cve-ws-edge cve-ws-edge-flow"
                      d={`M 290 ${CY} C 348 ${CY}, 380 ${node.y}, ${ASSET_X} ${node.y}`}
                      stroke={hexA(tone, 0.9)}
                      strokeWidth={1.1}
                    />
                  )}
                  <text
                    x={362}
                    y={(CY + node.y) / 2 - 6}
                    textAnchor="middle"
                    className="cve-ws-edge-label"
                    fill={tone}
                  >
                    {edgeLabel(node.alert)}
                  </text>
                </g>
              )
            })}

            {nodes.map((node) =>
              node.peers.map((peer) => (
                <path
                  key={`peer-edge-${peer.key}`}
                  className={cx(
                    'cve-ws-edge',
                    dimmedEdge(`asset:${node.alert.id}`, peer.key) && 'is-dim',
                  )}
                  d={`M ${ASSET_X + ASSET_W} ${node.y} L ${PEER_X} ${peer.y}`}
                  stroke="rgba(238,242,248,.26)"
                  strokeWidth={1}
                />
              )),
            )}

            {nodes.length === 0 && (
              <g className={cx('cve-ws-edge-group', dimmedEdge('cve', 'empty') && 'is-dim')}>
                <path
                  className="cve-ws-edge"
                  d={`M 290 ${CY} C 348 ${CY}, 380 ${CY}, ${ASSET_X} ${CY}`}
                  stroke="rgba(238,242,248,.22)"
                  strokeWidth={1.4}
                  strokeDasharray="4 5"
                />
                <text x={362} y={CY - 8} textAnchor="middle" className="cve-ws-edge-label" fill={SUPPRESSED}>
                  no correlation
                </text>
              </g>
            )}

            {cve.cwe.map((weakness, index) => {
              const y = cweY(index)
              const meta = cweMeta(weakness)
              return (
                <g
                  key={`weak-${weakness}`}
                  className={cx(
                    'cve-ws-node',
                    dimmed(`weak:${weakness}`) && 'is-dim',
                    selectedWeakness === weakness && 'is-selected',
                  )}
                  {...activate(`weak:${weakness}`, `${weakness}, ${meta.name}`, () =>
                    setSelected({ kind: 'weakness', cwe: weakness }),
                  )}
                >
                  <title>{`${weakness} · ${meta.name}`}</title>
                  <rect className="cve-ws-weak-card" x={18} y={y - 15} width={82} height={30} rx={7} />
                  <rect x={21} y={y - 11} width={2.5} height={22} rx={1.25} fill="#9b7bd4" opacity={0.85} />
                  <text className="cve-ws-weak-id" x={61} y={y + 3.5} textAnchor="middle">
                    {weakness}
                  </text>
                </g>
              )
            })}

            {nodes.map((node) => {
              const tone = toneFor(node.alert)
              const key = `asset:${node.alert.id}`
              const isSelected = selectedAssetId === node.alert.id
              return (
                <g
                  key={`asset-${node.alert.id}`}
                  className={cx(
                    'cve-ws-node',
                    dimmed(key) && 'is-dim',
                    isSelected && 'is-selected',
                    node.alert.suppressed && 'is-suppressed',
                  )}
                  {...activate(
                    key,
                    `${node.alert.asset.name}, ${REL[node.alert.relevance].label}, score ${fmtScore(node.alert.score)}`,
                    () => setSelected({ kind: 'asset', alertId: node.alert.id }),
                  )}
                >
                  <title>{`${node.alert.asset.name} · ${node.alert.relevance}`}</title>
                  <rect
                    className="cve-ws-asset-card"
                    x={ASSET_X}
                    y={node.y - 31}
                    width={ASSET_W}
                    height={62}
                    rx={10}
                  />
                  <circle cx={ASSET_X + 16} cy={node.y - 14} r={3} fill={tone} />
                  <text className="cve-ws-asset-name" x={ASSET_X + 25} y={node.y - 10}>
                    {clip(node.alert.asset.name, 16)}
                  </text>
                  <text className="cve-ws-asset-score" x={ASSET_X + ASSET_W - 12} y={node.y - 10} textAnchor="end" fill={tone}>
                    {fmtScore(node.alert.score)}
                  </text>
                  <text className="cve-ws-asset-sub" x={ASSET_X + 14} y={node.y + 7}>
                    installed {clip(node.alert.version, 16)}
                  </text>
                  <text className="cve-ws-asset-sub2" x={ASSET_X + 14} y={node.y + 22}>
                    {clip(node.alert.asset.department, 16)} · {node.alert.asset.internetFacing ? 'internet' : 'internal'}
                  </text>
                </g>
              )
            })}

            {nodes.map((node) =>
              node.peers.map((peer) => {
                const tone = peer.alert.suppressed ? SUPPRESSED : levelColor(peer.alert.level)
                const isSelected = selectedPeerId === peer.cve.id
                return (
                  <g
                    key={`peer-${peer.key}`}
                    className={cx(
                      'cve-ws-node',
                      dimmed(peer.key) && 'is-dim',
                      isSelected && 'is-selected',
                      peer.alert.suppressed && 'is-suppressed',
                    )}
                    {...activate(peer.key, `${peer.cve.id}, also exposed on ${peer.alert.asset.name}`, () =>
                      setSelected({ kind: 'peer', cveId: peer.cve.id }),
                    )}
                  >
                    <title>{`${peer.cve.id} · also on ${peer.alert.asset.name}`}</title>
                    <rect className="cve-ws-peer-card" x={PEER_X} y={peer.y - 15} width={PEER_W} height={30} rx={15} />
                    <rect x={PEER_X} y={peer.y - 15} width={3} height={30} rx={1.5} fill={tone} opacity={0.85} />
                    <text className="cve-ws-peer-id" x={PEER_X + 12} y={peer.y - 2}>
                      {peer.cve.id}
                    </text>
                    <text className="cve-ws-peer-sub" x={PEER_X + 12} y={peer.y + 9}>
                      {peer.alert.suppressed ? 'reviewed out' : 'also on this host'}
                    </text>
                  </g>
                )
              }),
            )}

            {nodes.length === 0 && (
              <g
                className={cx(
                  'cve-ws-node',
                  dimmed('empty') && 'is-dim',
                  selected.kind === 'empty' && 'is-selected',
                )}
                {...activate('empty', 'No correlated asset', () => setSelected({ kind: 'empty' }))}
              >
                <title>No correlated asset</title>
                <rect
                  className="cve-ws-asset-card cve-ws-empty-card"
                  x={ASSET_X}
                  y={CY - 31}
                  width={ASSET_W}
                  height={62}
                  rx={10}
                />
                <text className="cve-ws-empty-title" x={ASSET_X + ASSET_W / 2} y={CY - 4} textAnchor="middle">
                  No asset matched
                </text>
                <text className="cve-ws-empty-sub" x={ASSET_X + ASSET_W / 2} y={CY + 12} textAnchor="middle">
                  outside the relevance gate
                </text>
              </g>
            )}

            <g
              className={cx('cve-ws-node', 'cve-ws-core', dimmed('cve') && 'is-dim')}
              {...activate('cve', `${cve.id}, ${cve.severity} severity`, () => setSelected({ kind: 'cve' }))}
            >
              <title>{`${cve.id} · ${cve.severity}`}</title>
              <circle cx={CVE_CX} cy={CY} r={74} fill={sevColor} opacity={0.16} filter={`url(#glow-${uid})`} />
              {(cve.kev || cve.severity === 'CRITICAL') && (
                <circle className="cve-ws-pulse" cx={CVE_CX} cy={CY} r={CVE_R} fill="none" stroke={sevColor} strokeWidth={1.5} />
              )}
              <ellipse
                cx={CVE_CX}
                cy={CY}
                rx={80}
                ry={64}
                fill="none"
                stroke="rgba(238,242,248,.14)"
                strokeDasharray="1 7"
              />
              <circle cx={CVE_CX + 80} cy={CY} r={1.8} fill={sevColor} />
              <circle cx={CVE_CX} cy={CY} r={CVE_R} fill={sevColor} />
              <circle cx={CVE_CX} cy={CY} r={CVE_R} fill={`url(#shine-${uid})`} />
              <circle cx={CVE_CX} cy={CY} r={CVE_R} fill={`url(#shade-${uid})`} />
              <circle cx={CVE_CX} cy={CY} r={CVE_R} fill="none" stroke="rgba(255,255,255,.32)" />
              <text className="cve-ws-core-tag" x={CVE_CX} y={CY - 12} textAnchor="middle">
                CVE
              </text>
              <text className="cve-ws-core-digits" x={CVE_CX} y={CY + 8} textAnchor="middle">
                {cve.id.split('-').pop()}
              </text>
              <text className="cve-ws-core-label" x={CVE_CX} y={CY + 76} textAnchor="middle">
                {cve.id}
              </text>
              <text className="cve-ws-core-sub" x={CVE_CX} y={CY + 90} textAnchor="middle">
                {cve.severity} · {cve.kev ? 'CISA KEV' : 'not in KEV'}
              </text>
            </g>
          </svg>
          </div>
          <p className="cve-ws-pan-hint">
            <span>Swipe to pan</span>
            <span>Tap a node to inspect</span>
          </p>

          <div className="cve-ws-legend">
            <span>
              <i style={{ background: sevColor }} /> Matched
            </span>
            <span>
              <i style={{ background: '#e3a455' }} /> Version unverified
            </span>
            <span>
              <i style={{ background: SUPPRESSED }} /> Reviewed out
            </span>
            <span>
              <i style={{ background: '#9b7bd4' }} /> Weakness
            </span>
            <span>
              <i className="ring" /> Co-resident CVE
            </span>
            {hiddenCount > 0 && (
              <span className="cve-ws-legend-note">
                +{hiddenCount} more in the alert list
              </span>
            )}
            <span className="cve-ws-legend-hint">Click a node to inspect · peers pivot cases</span>
          </div>
        </div>

        <Inspector
          cve={cve}
          alerts={alerts}
          best={best}
          selection={selected}
          nodes={nodes}
          started={Boolean(flow)}
          onSelect={setSelected}
          onOpenResponse={onOpenResponse}
          onOpenCve={onOpenCve}
        />
      </div>

      {alerts.length > 0 && (
        <section className="cve-ws-paths">
          <header className="cve-ws-paths-head">
            <span className="mono">Correlated alerts</span>
            {flow && (
              <span className={cx('cve-flow-chip', `s-${flow.stage}`)}>
                <i />
                {stageLabel(flow.stage)}
              </span>
            )}
            <span className="cve-ws-paths-count">
              {alerts.length} {alerts.length === 1 ? 'path' : 'paths'}
            </span>
          </header>
          <div>
            {alerts.map((alert) => {
              const tone = toneFor(alert)
              const isSelected = selectedAssetId === alert.id
              return (
                <button
                  key={alert.id}
                  type="button"
                  className={cx('cve-ws-path', isSelected && 'is-selected', alert.suppressed && 'is-suppressed')}
                  aria-pressed={isSelected}
                  onClick={() => setSelected({ kind: 'asset', alertId: alert.id })}
                >
                  <span className="cve-ws-path-dot" style={{ background: tone }} />
                  <span className="cve-ws-path-main">
                    <span className="cve-ws-path-name">
                      {alert.asset.name} <small>{alert.asset.id}</small>
                    </span>
                    <span className="cve-ws-path-sub">
                      {REL[alert.relevance].label} · installed {alert.version} · {alert.asset.department}
                      {alert.suppressed && alert.wouldHaveScored != null
                        ? ` · would have scored ${fmtScore(alert.wouldHaveScored)}`
                        : ''}
                    </span>
                  </span>
                  <span className="cve-ws-path-score">
                    <b style={{ color: tone }}>{fmtScore(alert.score)}</b>
                    <span className="bar">
                      <i style={{ width: `${clamp(alert.score, 0, 100)}%`, background: tone }} />
                    </span>
                  </span>
                  <ArrowRight size={12} />
                </button>
              )
            })}
          </div>
        </section>
      )}
    </div>
  )
}

function Facts({ items }: { items: { label: string; value: ReactNode }[] }) {
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

function Inspector({
  cve,
  alerts,
  best,
  selection,
  nodes,
  started,
  onSelect,
  onOpenResponse,
  onOpenCve,
}: {
  cve: Cve
  alerts: Alert[]
  best: Alert | null
  selection: Selection
  nodes: AssetNode[]
  started: boolean
  onSelect: (selection: Selection) => void
  onOpenResponse: () => void
  onOpenCve: (cveId: string) => void
}) {
  const peerNode =
    selection.kind === 'peer'
      ? (nodes.flatMap((node) => node.peers).find((peer) => peer.cve.id === selection.cveId) ?? null)
      : null
  const assetAlert =
    selection.kind === 'asset'
      ? (alerts.find((alert) => alert.id === selection.alertId) ?? null)
      : null

  let tag = 'CVE CORE'
  let tone: string = LEVEL_COLORS[cve.severity]
  let title: ReactNode = cve.id
  let badges: ReactNode = (
    <>
      <SeverityBadge level={cve.severity} />
      {cve.kev && <span className="badge high">CISA KEV</span>}
    </>
  )
  let desc: ReactNode = best
    ? best.summary
    : `${cve.title}. No correlated asset exists in the demo inventory for this record.`
  let facts: { label: string; value: ReactNode }[] = [
    { label: 'CVSS', value: <span className="mono">{cve.cvss?.toFixed(1) ?? '—'}</span> },
    { label: 'EPSS', value: <span className="mono">{cve.epss == null ? '—' : fmtPct(cve.epss)}</span> },
    {
      label: 'KEV',
      value: cve.kev ? `Listed${cve.kevDue ? ` · due ${fmtDate(cve.kevDue)}` : ''}` : 'Not listed',
    },
    { label: 'Coverage', value: `${alerts.filter((alert) => !alert.suppressed).length} active · ${alerts.filter((alert) => alert.suppressed).length} reviewed out` },
  ]
  let wfAlert: Alert | null = best
  let cta: ReactNode = (
    <button className="btn btn-primary btn-sm" onClick={onOpenResponse}>
      {started ? 'Open response' : 'Start response'} <ArrowRight size={12} />
    </button>
  )

  if (assetAlert) {
    const assetTone = toneFor(assetAlert)
    tag = 'EXPOSED ASSET'
    tone = assetTone
    title = assetAlert.asset.name
    badges = (
      <>
        <SeverityBadge level={assetAlert.level} suppressed={assetAlert.suppressed} />
        <RelevanceBadge relevance={assetAlert.relevance} />
      </>
    )
    desc = assetAlert.summary
    facts = [
      { label: 'Installed', value: <span className="mono">{assetAlert.version}</span> },
      { label: 'Affected range', value: <span className="mono">{rangeText(cve)}</span> },
      {
        label: 'Criticality',
        value: `${assetAlert.asset.criticality} · ${assetAlert.asset.internetFacing ? 'internet-facing' : 'internal'}`,
      },
      {
        label: 'Business',
        value: `${assetAlert.asset.department} — ${assetAlert.asset.businessFunction}`,
      },
      {
        label: 'Risk score',
        value: (
          <span className="mono" style={{ color: assetTone }}>
            {fmtScore(assetAlert.score)}
          </span>
        ),
      },
    ]
    wfAlert = assetAlert
    cta = (
      <>
        <button className="btn btn-ghost btn-sm" onClick={() => onSelect({ kind: 'cve' })}>
          CVE root
        </button>
        <button className="btn btn-primary btn-sm" onClick={onOpenResponse}>
          Respond <ArrowRight size={12} />
        </button>
      </>
    )
  } else if (selection.kind === 'peer' && peerNode) {
    tag = 'CO-RESIDENT CVE'
    tone = peerNode.alert.suppressed ? SUPPRESSED : levelColor(peerNode.alert.level)
    title = peerNode.cve.id
    badges = (
      <>
        <SeverityBadge level={peerNode.cve.severity} />
        {peerNode.cve.kev && <span className="badge high">CISA KEV</span>}
      </>
    )
    desc = peerNode.cve.title
    facts = [
      { label: 'CVSS', value: <span className="mono">{peerNode.cve.cvss?.toFixed(1) ?? '—'}</span> },
      { label: 'EPSS', value: <span className="mono">{peerNode.cve.epss == null ? '—' : fmtPct(peerNode.cve.epss)}</span> },
      { label: 'Shared host', value: peerNode.alert.asset.name },
      { label: 'Relevance', value: REL[peerNode.alert.relevance].label },
    ]
    wfAlert = peerNode.alert
    cta = (
      <>
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => onSelect({ kind: 'asset', alertId: peerNode.alert.id })}
        >
          Host
        </button>
        <button className="btn btn-primary btn-sm" onClick={() => onOpenCve(peerNode.cve.id)}>
          Open case <ArrowRight size={12} />
        </button>
      </>
    )
  } else if (selection.kind === 'weakness') {
    const meta = cweMeta(selection.cwe)
    const digits = selection.cwe.split('-')[1] ?? ''
    tag = 'WEAKNESS CLASS'
    tone = '#9b7bd4'
    title = selection.cwe
    badges = <span className="badge simulated">Weakness class</span>
    desc = `${meta.name}. ${meta.note}`
    facts = [
      { label: 'Class', value: meta.name },
      { label: 'Recorded in', value: `${cve.vendor} ${cve.product}` },
      { label: 'In this record', value: `${cve.cwe.length} weakness class${cve.cwe.length === 1 ? '' : 'es'}` },
    ]
    wfAlert = null
    cta = (
      <a
        className="btn btn-ghost btn-sm"
        href={`https://cwe.mitre.org/data/definitions/${digits}.html`}
        target="_blank"
        rel="noreferrer"
      >
        MITRE definition <ExternalLink size={11} />
      </a>
    )
  } else if (selection.kind === 'empty') {
    tag = 'NO CORRELATION'
    tone = SUPPRESSED
    title = 'No correlated asset'
    badges = null
    desc =
      'No inventory record passed the relevance gate for this CVE. Keep it on watch, or open a response to track a version check.'
    facts = [
      { label: 'CVSS', value: <span className="mono">{cve.cvss?.toFixed(1) ?? '—'}</span> },
      { label: 'EPSS', value: <span className="mono">{cve.epss == null ? '—' : fmtPct(cve.epss)}</span> },
      { label: 'KEV', value: cve.kev ? 'Listed' : 'Not listed' },
      { label: 'Coverage', value: 'No correlated alert' },
    ]
    wfAlert = null
  }

  return (
    <aside className="cve-ws-inspect" aria-label="Node inspector">
      <div className="cve-ws-inspect-head">
        <span className="mono">Node inspector</span>
        {selection.kind !== 'cve' && (
          <button type="button" onClick={() => onSelect({ kind: 'cve' })}>
            <X size={10} /> CVE root
          </button>
        )}
      </div>
      <div className="cve-ws-inspect-body">
        <span className="cve-ws-inspect-tag">
          <i style={{ background: tone }} />
          {tag}
        </span>
        <h3 className="cve-ws-inspect-title">{title}</h3>
        {badges && <div className="cve-ws-inspect-badges">{badges}</div>}
        <p className="cve-ws-inspect-desc">{desc}</p>
        <Facts items={facts} />
        {wfAlert && (
          <div className="cve-ws-inspect-wf">
            <span className="mono">Score anatomy</span>
            <Waterfall alert={wfAlert} compact />
          </div>
        )}
      </div>
      <div className="cve-ws-inspect-foot">{cta}</div>
    </aside>
  )
}
