import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { Chart, axisStyle, chartTokens } from './Chart'
import { ChartCard } from './WbCharts'
import { Drawer, DrawerHead } from './Drawer'
import { SeverityBadge, SimulatedBadge, SourceBadge } from './Badges'
import { useTheme } from '../lib/store'
import { hexA, levelColor } from '../lib/colors'
import { cx } from '../lib/format'
import { sum } from '../lib/stats'
import {
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Crosshair,
  ExternalLink,
  Grid3X3,
  Info,
} from './Icons'
import type { AttackProfile, RiskLevel, Technique } from '../lib/types'

/* A technique as the matrix page models it, plus the aggregates the workbench needs to
   place one node in context. Mitre.tsx declares structurally identical types, so its
   own Node/Column objects satisfy these without a shared-module refactor. */
export interface TechniqueNode {
  tech: Technique
  profiles: AttackProfile[]
  severity: RiskLevel | null
  exposure: number
}

export interface TechniqueColumn {
  id: string
  name: string
  nodes: TechniqueNode[]
  events: number
  owned: number
}

export interface TechniqueLens {
  key: string
  label: string
  hue: string
  unit: string
  note: string
  value: (node: TechniqueNode) => number
}

export interface TechniqueContext {
  nodes: TechniqueNode[]
  columns: TechniqueColumn[]
  order: TechniqueNode[]
  lenses: TechniqueLens[]
  months: string[]
  sevWeight: Record<RiskLevel, number>
  hues: { loud: string; own: string; risk: string; quiet: string }
}

type TabKey = 'signal' | 'playbooks' | 'chain' | 'coverage'

const TABS: TabKey[] = ['signal', 'playbooks', 'chain', 'coverage']

const TAB_LABELS: Record<TabKey, string> = {
  signal: 'Signal',
  playbooks: 'Playbooks',
  chain: 'Chain',
  coverage: 'Coverage',
}

const SEV_ORDER: RiskLevel[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']

const pct = (value: number, total: number) => (total > 0 ? (value / total) * 100 : 0)
const unitFor = (value: number, unit: string) => (value === 1 ? unit.replace(/s$/, '') : unit)

function analyse(node: TechniqueNode, ctx: TechniqueContext) {
  const { nodes, columns, months, sevWeight } = ctx
  const observedTotal = sum(nodes.map((n) => n.tech.observed))
  const exposureTotal = sum(nodes.map((n) => n.exposure))
  const rankedNodes = [...nodes].sort((a, b) => b.tech.observed - a.tech.observed)
  const column = columns.find((c) => c.id === node.tech.tacticId) ?? null
  const columnId = columns.findIndex((c) => c.id === node.tech.tacticId)
  const peers = [...(column?.nodes ?? [])].sort((a, b) => b.tech.observed - a.tech.observed)
  const tacticEvents = column?.events ?? 0
  const weight = node.severity ? sevWeight[node.severity] : 1

  const byId = new Map(nodes.map((n) => [n.tech.id, n]))
  const cooccurCount = new Map<string, number>()
  node.profiles.forEach((p) =>
    p.techniques
      .filter((id) => id !== node.tech.id)
      .forEach((id) => cooccurCount.set(id, (cooccurCount.get(id) ?? 0) + 1)),
  )
  const cooccurring = [...cooccurCount]
    .map(([id, count]) => ({ peer: byId.get(id), count }))
    .filter((row): row is { peer: TechniqueNode; count: number } => Boolean(row.peer))
    .sort((a, b) => b.count - a.count || b.peer.tech.observed - a.peer.tech.observed)

  const controlMap = new Map<string, { control: string; teams: Set<string>; profiles: AttackProfile[] }>()
  node.profiles.forEach((p) =>
    p.mitigations.forEach((m) => {
      const row = controlMap.get(m.control) ?? { control: m.control, teams: new Set<string>(), profiles: [] }
      row.teams.add(m.team)
      row.profiles.push(p)
      controlMap.set(m.control, row)
    }),
  )
  const controls = [...controlMap.values()].map((row) => ({
    control: row.control,
    teams: [...row.teams],
    profiles: row.profiles,
    level: ([...new Set(row.profiles.map((p) => p.defaultSeverity))].sort(
      (a, b) => SEV_ORDER.indexOf(a) - SEV_ORDER.indexOf(b),
    )[0] ?? 'LOW') as RiskLevel,
  }))

  const promptMap = new Map<string, AttackProfile[]>()
  node.profiles.forEach((p) => p.indicators.forEach((i) => promptMap.set(i, [...(promptMap.get(i) ?? []), p])))
  const prompts = [...promptMap].map(([text, from]) => ({ text, from }))

  const sevCounts = SEV_ORDER.map((level) => ({
    level,
    count: node.profiles.filter((p) => p.defaultSeverity === level).length,
  })).filter((row) => row.count > 0)

  const rawShape = months.map(
    (_, i) => node.tech.observed * (0.5 + Math.abs(Math.sin((i * 1.9 + node.tech.observed * 2 + node.tech.name.length) / 2.4))),
  )
  const shapeBase = sum(rawShape) || 1
  const monthlyShape = rawShape.map((v) => Math.round((v / shapeBase) * node.tech.observed * 10) / 10)
  /* 1-dp rounding leaves a residual against the observed total; parking it on the peak
     month keeps the strip honest about summing to the technique's own count. */
  const drift = Math.round((node.tech.observed - sum(monthlyShape)) * 10) / 10
  if (drift !== 0) {
    const peak = monthlyShape.indexOf(Math.max(...monthlyShape))
    monthlyShape[peak] = Math.round((monthlyShape[peak] + drift) * 10) / 10
  }

  return {
    observedTotal,
    exposureTotal,
    rankedNodes,
    rank: rankedNodes.findIndex((n) => n.tech.id === node.tech.id) + 1,
    column,
    columnId,
    peers,
    tacticEvents,
    estateMean: observedTotal / Math.max(1, nodes.length),
    tacticMean: tacticEvents / Math.max(1, peers.length),
    weight,
    cooccurring,
    controls,
    prompts,
    sevCounts,
    monthlyShape,
    peakMonth: monthlyShape.indexOf(Math.max(...monthlyShape)),
    prevColumn: columnId > 0 ? columns[columnId - 1] : null,
    nextColumn: columnId >= 0 && columnId < columns.length - 1 ? columns[columnId + 1] : null,
    ownedNodes: nodes.filter((n) => n.profiles.length),
    ownedEvents: sum(nodes.filter((n) => n.profiles.length).map((n) => n.tech.observed)),
  }
}

export function TechniqueWorkbench({
  node,
  ctx,
  lensKey,
  onClose,
  onOpen,
  onProfile,
}: {
  node: TechniqueNode | null
  ctx: TechniqueContext
  lensKey: string
  onClose: () => void
  onOpen: (node: TechniqueNode) => void
  onProfile: (key: string) => void
}) {
  return (
    <Drawer open={Boolean(node)} onClose={onClose} label="Technique workbench" wide>
      {node && (
        <WorkbenchBody
          node={node}
          ctx={ctx}
          lensKey={lensKey}
          onClose={onClose}
          onOpen={onOpen}
          onProfile={onProfile}
        />
      )}
    </Drawer>
  )
}

function WorkbenchBody({
  node,
  ctx,
  lensKey,
  onClose,
  onOpen,
  onProfile,
}: {
  node: TechniqueNode
  ctx: TechniqueContext
  lensKey: string
  onClose: () => void
  onOpen: (node: TechniqueNode) => void
  onProfile: (key: string) => void
}) {
  const [tab, setTab] = useState<TabKey>('signal')
  const navigate = useNavigate()
  const theme = useTheme((s) => s.theme)

  const stepIndex = ctx.order.findIndex((n) => n.tech.id === node.tech.id)
  const prev = stepIndex > 0 ? ctx.order[stepIndex - 1] : null
  const next = stepIndex >= 0 && stepIndex < ctx.order.length - 1 ? ctx.order[stepIndex + 1] : null
  const railRef = useRef<HTMLDivElement | null>(null)

  /* Fourteen tactic columns never fit the drawer, so the rail opens with the current
     column already in view instead of parked off the right edge. */
  useEffect(() => {
    if (tab !== 'chain') return
    const rail = railRef.current
    const active = rail?.querySelector<HTMLElement>('[data-on="1"]')
    if (!rail || !active) return
    const railBox = rail.getBoundingClientRect()
    const activeBox = active.getBoundingClientRect()
    rail.scrollLeft += activeBox.left - railBox.left - (rail.clientWidth - activeBox.width) / 2
  }, [tab, node])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return
      if (event.key === 'ArrowLeft' && prev) onOpen(prev)
      if (event.key === 'ArrowRight' && next) onOpen(next)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [node, prev, next, onOpen])

  const detail = useMemo(() => analyse(node, ctx), [node, ctx])
  const activeLens = ctx.lenses.find((l) => l.key === lensKey) ?? ctx.lenses[0]
  const lensValue = activeLens.value

  const peerOption = useMemo(() => {
    const t = chartTokens(theme)
    const head = detail.peers.slice(0, 8)
    const rows = head.some((n) => n.tech.id === node.tech.id)
      ? head
      : [...head, node]
    const listed = [...rows]
      .filter((n, i, all) => all.findIndex((m) => m.tech.id === n.tech.id) === i)
      .sort((a, b) => lensValue(a) - lensValue(b))
    const estateMax = Math.max(...ctx.nodes.map(lensValue), 1)
    return {
      grid: { left: 2, right: 34, top: 4, bottom: 2, containLabel: true },
      tooltip: {
        trigger: 'item',
        formatter: (p: { dataIndex: number }) =>
          `${listed[p.dataIndex].tech.id} · ${listed[p.dataIndex].tech.name}<br/>${listed[p.dataIndex].tech.observed} observed · ${
            lensValue(listed[p.dataIndex])
          } ${activeLens.label.toLowerCase()}`,
      },
      xAxis: { type: 'value', max: estateMax, ...axisStyle(theme) },
      yAxis: {
        type: 'category',
        data: listed.map((n) => n.tech.id),
        ...axisStyle(theme, { split: false }),
        axisLabel: { ...axisStyle(theme).axisLabel, fontSize: 9, interval: 0 },
      },
      series: [
        {
          type: 'bar',
          barWidth: 11,
          data: listed.map((n) => ({
            value: lensValue(n),
            itemStyle: {
              borderRadius: [0, 3, 3, 0],
              color: n.tech.id === node.tech.id ? activeLens.hue : hexA(ctx.hues.quiet, 0.55),
            },
          })),
          label: {
            show: true,
            position: 'right',
            distance: 5,
            fontSize: 9,
            fontFamily: 'JetBrains Mono Variable, monospace',
            color: t.muted,
          },
        },
      ],
    }
  }, [node, detail, theme, ctx, activeLens, lensValue])

  const footprintOption = useMemo(() => {
    if (node.profiles.length === 0) return null
    const t = chartTokens(theme)
    const rows = [...node.profiles].sort((a, b) => a.techniques.length - b.techniques.length)
    const maxSpan = Math.max(...ctx.nodes.flatMap((n) => n.profiles.map((p) => p.techniques.length)), 1)
    return {
      grid: { left: 2, right: 34, top: 4, bottom: 2, containLabel: true },
      tooltip: {
        trigger: 'item',
        formatter: (p: { dataIndex: number }) =>
          `${rows[p.dataIndex].name}<br/>${rows[p.dataIndex].techniques.length} techniques · ${
            rows[p.dataIndex].defaultSeverity
          }`,
      },
      xAxis: { type: 'value', max: maxSpan, ...axisStyle(theme) },
      yAxis: {
        type: 'category',
        data: rows.map((p) => p.key.toUpperCase()),
        ...axisStyle(theme, { split: false }),
        axisLabel: { ...axisStyle(theme).axisLabel, fontSize: 9, interval: 0 },
      },
      series: [
        {
          type: 'bar',
          barWidth: 11,
          data: rows.map((p) => ({
            value: p.techniques.length,
            itemStyle: { borderRadius: [0, 3, 3, 0], color: levelColor(p.defaultSeverity) },
          })),
          label: {
            show: true,
            position: 'right',
            distance: 5,
            fontSize: 9,
            color: t.muted,
            fontFamily: 'JetBrains Mono Variable, monospace',
          },
        },
      ],
    }
  }, [node, theme, ctx])

  const { rank, column, peers, tacticEvents, estateMean, tacticMean, weight, ownedEvents } = detail
  const shareTactic = pct(node.tech.observed, tacticEvents)
  const shareEstate = pct(node.tech.observed, detail.observedTotal)
  const loudnessVsTactic = tacticMean > 0 ? node.tech.observed / tacticMean : 0
  const loudnessVsEstate = estateMean > 0 ? node.tech.observed / estateMean : 0
  const shapePeak = Math.max(...detail.monthlyShape, 1)
  const teams = new Set(detail.controls.flatMap((c) => c.teams))

  const metrics = [
    { label: 'Observed events', value: `${node.tech.observed}`, sub: `of ${detail.observedTotal} matrix-wide` },
    { label: 'Loudness rank', value: `#${rank}`, sub: `of ${ctx.nodes.length} techniques` },
    { label: 'Playbooks', value: `${node.profiles.length}`, sub: node.profiles.length ? 'documented chains' : 'documentation gap' },
    { label: 'Exposure', value: `${node.exposure}`, sub: `×${weight.toFixed(1)} severity weight` },
    { label: 'Tactic share', value: `${shareTactic.toFixed(0)}%`, sub: `of ${column?.name ?? '—'}` },
    { label: 'Top severity', value: node.severity ?? 'None', sub: node.severity ? 'from linked playbooks' : 'no linked playbook', tone: node.severity },
  ]

  const openNode = (target: TechniqueNode) => onOpen(target)

  return (
    <>
      <DrawerHead
        overline={`${node.tech.id} · ${node.tech.tactic.toUpperCase()}`}
        title={node.tech.name}
        onClose={onClose}
        meta={
          <span className="wb-head-meta">
            <SourceBadge source="MITRE ATT&CK" simulated />
            <span className="badge simulated">trimmed subset</span>
            <span className="mkw-step">
              <button
                type="button"
                className="btn btn-ghost btn-sm mkw-step-btn"
                onClick={() => prev && openNode(prev)}
                disabled={!prev}
                aria-label="Previous technique"
              >
                <ChevronLeft size={13} />
              </button>
              <span className="mkw-step-count mono">{stepIndex + 1} / {ctx.order.length}</span>
              <button
                type="button"
                className="btn btn-ghost btn-sm mkw-step-btn"
                onClick={() => next && openNode(next)}
                disabled={!next}
                aria-label="Next technique"
              >
                <ChevronRight size={13} />
              </button>
            </span>
          </span>
        }
      />

      <div className="drawer-body wb-body" style={{ '--mkw-hue': activeLens.hue } as CSSProperties}>
        <div className="wb-livebar">
          <span className="wb-live-dot on" />
          <span className="wb-live-text">
            {column?.name ?? node.tech.tactic} · {peers.length} {peers.length === 1 ? 'technique' : 'techniques'} in this
            column · {tacticEvents} observed events
          </span>
          <span className="wb-live-sources">MATRIX → {node.tech.tacticId.toUpperCase()}</span>
        </div>

        <div className="wb-metrics mkw-metrics">
          {metrics.map((metric) => (
            <div className="wb-metric" key={metric.label}>
              <span>{metric.label}</span>
              <b className={metric.tone ? `tone-${metric.tone.toLowerCase()}` : undefined}>{metric.value}</b>
              <em className="wb-metric-sub">{metric.sub}</em>
            </div>
          ))}
        </div>

        <p className="mkw-lead">{node.tech.description}</p>

        <div className="wb-tabs" role="tablist" aria-label="Technique analysis sections">
          {TABS.map((key) => (
            <button
              key={key}
              role="tab"
              aria-selected={tab === key}
              className={cx('wb-tab', tab === key && 'on')}
              onClick={() => setTab(key)}
            >
              {TAB_LABELS[key]}
            </button>
          ))}
        </div>

        <div className="wb-panel" role="tabpanel" aria-label={TAB_LABELS[tab]}>
          {tab === 'signal' && (
            <>
              <div className="wb-analysis">
                <ChartCard title={`Loudness in ${column?.name ?? 'this tactic'}`} sub={`ranked by ${activeLens.label.toLowerCase()}`}>
                  {peerOption ? <Chart option={peerOption} height={Math.max(150, 22 + peers.length * 20)} /> : null}
                </ChartCard>
                <ChartCard title="Where the number comes from" sub="this technique against its own averages">
                  <div className="wb-bars wb-bars-detail">
                    <BarRow label="This technique" value={node.tech.observed} max={Math.max(node.tech.observed, tacticMean, estateMean)} fill={activeLens.hue} note="events" />
                    <BarRow label="Tactic mean" value={Math.round(tacticMean * 10) / 10} max={Math.max(node.tech.observed, tacticMean, estateMean)} fill={ctx.hues.risk} note="events" />
                    <BarRow label="Estate mean" value={Math.round(estateMean * 10) / 10} max={Math.max(node.tech.observed, tacticMean, estateMean)} fill={hexA(ctx.hues.quiet, 0.7)} note="events" />
                  </div>
                  <div className="mkw-ratios">
                    <span>
                      <b>{loudnessVsTactic.toFixed(2)}×</b> the mean of {column?.name ?? 'its tactic'}
                    </span>
                    <span>
                      <b>{loudnessVsEstate.toFixed(2)}×</b> the estate-wide mean
                    </span>
                  </div>
                </ChartCard>
                <ChartCard title="Monthly shape" sub="illustrative · sums to the observed total">
                  <div className="mkw-spark">
                    {detail.monthlyShape.map((v, i) => (
                      <div key={ctx.months[i]} className={cx('mkw-spark-cell', i === detail.peakMonth && 'peak')}>
                        <span className="mkw-spark-bars">
                          <i
                            style={
                              {
                                height: `${Math.max(8, (v / shapePeak) * 100)}%`,
                                '--mr-fill': activeLens.hue,
                              } as CSSProperties
                            }
                          />
                        </span>
                        <em className="mono">{ctx.months[i]}</em>
                      </div>
                    ))}
                  </div>
                  <div className="mkw-spark-read mono">
                    <span>
                      peak {ctx.months[detail.peakMonth]} · {detail.monthlyShape[detail.peakMonth]} ev
                    </span>
                    <span>
                      Σ {Math.round(sum(detail.monthlyShape) * 10) / 10} ev · mean{' '}
                      {Math.round((node.tech.observed / ctx.months.length) * 10) / 10} ev
                    </span>
                  </div>
                  <div className="wb-footnote">
                    <SimulatedBadge />
                    <span>The spread is a shape that sums to this technique's observed total, not captured telemetry.</span>
                  </div>
                </ChartCard>
              </div>

              <div className="wb-grid wb-grid-2 wb-spread">
                <Card title="Exposure build-up" sub="how the exposure lens scores this node">
                  <div className="wb-weights">
                    <WeightRow label="Observed events" value={`${node.tech.observed}`} share={pct(node.tech.observed, detail.observedTotal)} fill={ctx.hues.loud} />
                    <WeightRow label={`Severity weight (${node.severity ?? 'unlinked'})`} value={`×${weight.toFixed(1)}`} share={pct(weight, 3)} fill={ctx.hues.own} />
                    <WeightRow label="Exposure points" value={`${node.exposure}`} share={pct(node.exposure, detail.exposureTotal)} fill={ctx.hues.risk} />
                  </div>
                  <p className="wb-note mono">
                    {node.tech.observed} observed × {weight.toFixed(1)} = {node.exposure} pts · {pct(node.exposure, detail.exposureTotal).toFixed(1)}% of
                    matrix exposure
                  </p>
                </Card>

                <Card title="Matrix record" sub="what the page knows about this technique">
                  <div className="wb-kv">
                    <Kv label="Technique ID" value={node.tech.id} />
                    <Kv label="Tactic" value={node.tech.tactic} />
                    <Kv label="Tactic ID" value={node.tech.tacticId} />
                    <Kv label="Matrix rank" value={`#${rank} of ${ctx.nodes.length}`} />
                    <Kv label="Linked playbooks" value={`${node.profiles.length}`} />
                    <Kv label="Detection prompts" value={`${detail.prompts.length}`} />
                  </div>
                  <div className="wb-action-buttons">
                    <a className="btn btn-ghost btn-sm" href={`https://attack.mitre.org/techniques/${node.tech.id.replace('.', '/')}/`} target="_blank" rel="noreferrer">
                      Open on attack.mitre.org <ExternalLink size={11} />
                    </a>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => navigate('/app/attacks')}>
                      Attack profiles <ArrowRight size={11} />
                    </button>
                  </div>
                </Card>
              </div>

              <Card title={`Other techniques in ${column?.name ?? 'this tactic'}`} sub="tap a row to move the workbench">
                <div className="wb-node-list">
                  {peers
                    .filter((n) => n.tech.id !== node.tech.id)
                    .map((n) => (
                      <NodeRow key={n.tech.id} node={n} rank={detail.rankedNodes.findIndex((m) => m.tech.id === n.tech.id) + 1} onOpen={openNode} />
                    ))}
                  {!peers.some((n) => n.tech.id !== node.tech.id) && (
                    <EmptyNote
                      title="Only technique in this column"
                      body={`${node.tech.id} is the sole ${node.tech.tactic} technique in this trimmed subset, so there is no same-tactic peer to compare it against.`}
                    />
                  )}
                </div>
              </Card>
            </>
          )}

          {tab === 'playbooks' && (
            <>
              {node.profiles.length === 0 ? (
                <Card title="No playbook documents this technique" sub="the behaviour is observed but unmapped">
                  <div className="wb-empty">
                    <Info size={15} />
                    <div>
                      <strong>Documentation gap</strong>
                      <p>
                        None of the {ctx.nodes.length} × {node.tech.id} links resolve: no attack profile in the demo set lists this
                        technique. {node.tech.observed} observed event{node.tech.observed === 1 ? '' : 's'} still carry it, so exposure is
                        scored at weight ×1.0 with no owned control chain behind it.
                      </p>
                    </div>
                  </div>
                  <div className="wb-action-buttons">
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => navigate('/app/attacks')}>
                      Author a profile <ArrowRight size={11} />
                    </button>
                  </div>
                </Card>
              ) : (
                <>
                  <div className="wb-grid wb-grid-2 wb-spread">
                    <ChartCard title="Playbook footprint" sub="how many techniques each linked profile spans">
                      {footprintOption ? (
                        <Chart option={footprintOption} height={Math.max(120, 34 + node.profiles.length * 24)} />
                      ) : null}
                    </ChartCard>
                    <Card title="Severity of the linked chains" sub="worst case drives the exposure weight">
                      <div className="wb-bars wb-bars-detail">
                        {detail.sevCounts.map((row) => (
                          <BarRow
                            key={row.level}
                            label={row.level.toLowerCase()}
                            value={row.count}
                            max={Math.max(...detail.sevCounts.map((s) => s.count))}
                            fill={levelColor(row.level)}
                            note={row.count === 1 ? 'profile' : 'profiles'}
                          />
                        ))}
                      </div>
                      <p className="wb-note mono">
                        top severity {node.severity} → weight ×{weight.toFixed(1)} → {node.exposure} exposure pts
                      </p>
                    </Card>
                  </div>

                  {node.profiles.map((profile) => (
                    <PlaybookBlock
                      key={profile.key}
                      profile={profile}
                      currentId={node.tech.id}
                      resolve={(id) => ctx.nodes.find((n) => n.tech.id === id) ?? null}
                      onOpen={openNode}
                      onProfile={onProfile}
                    />
                  ))}
                </>
              )}
            </>
          )}

          {tab === 'chain' && (
            <>
              <Card title="Tactic rail" sub="where this technique sits in the column order">
                <div className="mkw-rail" ref={railRef}>
                  {ctx.columns.map((c, i) => (
                    <div key={c.id} data-on={c.id === node.tech.tacticId ? '1' : undefined} className={cx('mkw-rail-item', c.id === node.tech.tacticId && 'on')}>
                      <span className="mkw-rail-cap mono">{String(i + 1).padStart(2, '0')}</span>
                      <strong className="mkw-rail-name">{c.name}</strong>
                      <span className="mkw-rail-val mono">{c.events} ev</span>
                      <span className="mkw-rail-val mono dim">
                        {c.owned}/{c.nodes.length} owned
                      </span>
                      {c.id === node.tech.tacticId && <span className="mkw-rail-here mono">{node.tech.id}</span>}
                    </div>
                  ))}
                </div>
                <div className="mkw-handoff">
                  <HandoffCell
                    dir="Arrives from"
                    column={detail.prevColumn}
                    currentId={node.tech.id}
                    onOpen={openNode}
                  />
                  <HandoffCell
                    dir="Feeds into"
                    column={detail.nextColumn}
                    currentId={node.tech.id}
                    onOpen={openNode}
                  />
                </div>
              </Card>

              <div className="wb-grid wb-grid-2 wb-spread mkw-hug">
                <Card title="Kill-chain positions" sub="where this technique appears inside each linked playbook">
                  {node.profiles.length ? (
                    <div className="mkw-chains">
                      {node.profiles.map((p) => (
                        <div className="mkw-chain" key={p.key}>
                          <div className="mkw-chain-head">
                            <strong>{p.name}</strong>
                            <SeverityBadge level={p.defaultSeverity} />
                          </div>
                          <div className="wb-runbook">
                            {p.stages.map((stage, i) => (
                              <div className={cx('wb-runbook-step', stage.tactic === node.tech.tactic && 'mkw-on')} key={`${p.key}-${i}`}>
                                <span>{String(i + 1).padStart(2, '0')}</span>
                                <div>
                                  <strong>{stage.tactic}</strong>
                                  <p>{stage.note}</p>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <EmptyNote
                      title="No authored chain to place"
                      body="Without a linked profile there is no staged sequence to position this technique in. The column rail above is the only ordering evidence the subset carries."
                    />
                  )}
                </Card>

                <Card title="Co-occurrence" sub="techniques travelling in the same playbooks">
                  {detail.cooccurring.length ? (
                    <div className="wb-node-list wb-list-scroll">
                      {detail.cooccurring.slice(0, 12).map((row) => (
                        <button type="button" className="wb-node-row" key={row.peer.tech.id} onClick={() => openNode(row.peer)}>
                          <span className="wb-node-dot" style={{ background: row.peer.severity ? levelColor(row.peer.severity) : ctx.hues.quiet }} />
                          <span className="wb-node-main">
                            <strong>{row.peer.tech.name}</strong>
                            <span className="mono">
                              {row.peer.tech.id} · {row.peer.tech.tactic}
                            </span>
                          </span>
                          <span className="mkw-shared mono">
                            {row.count} shared
                          </span>
                          <span className="wb-node-score">{row.peer.tech.observed}</span>
                          <ArrowRight size={12} />
                        </button>
                      ))}
                    </div>
                  ) : (
                    <EmptyNote
                      title="Nothing shares this technique"
                      body="No other technique in the subset appears in the same playbooks, so this node stands alone in the correlation graph."
                    />
                  )}
                </Card>
              </div>
            </>
          )}

          {tab === 'coverage' && (
            <>
              <div className="wb-grid wb-grid-2 wb-spread">
                <Card title="Coverage math" sub="what this node contributes to the board">
                  <div className="wb-bars wb-bars-detail">
                    <BarRow label="Of estate events" value={Math.round(shareEstate * 10) / 10} max={100} fill={ctx.hues.loud} note="%" />
                    <BarRow label={`Of ${column?.name ?? 'tactic'}`} value={Math.round(shareTactic * 10) / 10} max={100} fill={ctx.hues.risk} note="%" />
                    <BarRow label="Inside a playbook" value={Math.round(pct(ownedEvents, detail.observedTotal) * 10) / 10} max={100} fill={ctx.hues.own} note="%" />
                    <BarRow label="Techniques mapped" value={Math.round(pct(detail.ownedNodes.length, ctx.nodes.length) * 10) / 10} max={100} fill={hexA(ctx.hues.quiet, 0.8)} note="%" />
                  </div>
                  <div className="wb-kv mkw-counts">
                    <Kv label="Playbooks" value={`${node.profiles.length}`} />
                    <Kv label="Controls" value={`${detail.controls.length}`} />
                    <Kv label="Owning teams" value={`${teams.size}`} />
                    <Kv label="Prompts" value={`${detail.prompts.length}`} />
                  </div>
                  <div className="wb-footnote">
                    <Crosshair size={12} />
                    <span>
                      {node.profiles.length
                        ? `${detail.controls.length} control${detail.controls.length === 1 ? '' : 's'} across ${teams.size} team${teams.size === 1 ? '' : 's'} cover this technique.`
                        : 'No control in the subset names this technique, so nothing is owned.'}
                    </span>
                  </div>
                </Card>

                <Card title="Ownership ledger" sub="controls mapped to this technique by its playbooks">
                  {detail.controls.length ? (
                    <div className="wb-evidence-list mkw-ledger">
                      {detail.controls.map((row) => (
                        <div className="wb-evidence-row" key={row.control}>
                          <div>
                            <strong>{row.control}</strong>
                            <span>{row.profiles.map((p) => p.name).join(' · ')}</span>
                          </div>
                          <div>
                            <strong>{row.teams.join(', ')}</strong>
                            <span>owner</span>
                          </div>
                          <div>
                            <strong className="mono">{row.profiles.length}</strong>
                            <span>playbook{row.profiles.length === 1 ? '' : 's'}</span>
                          </div>
                          <div>
                            <SeverityBadge level={row.level} />
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <EmptyNote
                      title="Nothing owned yet"
                      body="This technique has no mitigation entry because no playbook links it. Treat it as an audit finding: observed behaviour, zero documented control."
                    />
                  )}
                </Card>
              </div>

              <Card title="Detection prompts" sub="telemetry asks inherited from the linked playbooks">
                {detail.prompts.length ? (
                  <div className="mkw-prompts">
                    {detail.prompts.map((prompt) => (
                      <div className="mkw-prompt" key={prompt.text}>
                        <span className="mono">{prompt.text}</span>
                        <span className="mkw-prompt-from">
                          {prompt.from.map((p) => p.name).join(' · ')}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyNote
                    title="No prompt available"
                    body="Detection guidance reaches this technique only through a playbook. Author one on the attack profiles page and its indicators appear here."
                  />
                )}
              </Card>

              <Card title="References" sub="where the record came from">
                <div className="wb-refs">
                  <a className="wb-link" href={`https://attack.mitre.org/techniques/${node.tech.id.replace('.', '/')}/`} target="_blank" rel="noreferrer">
                    {node.tech.id} on ATT&CK <ExternalLink size={10} />
                  </a>
                  <a className="wb-link" href={`https://attack.mitre.org/tactics/${node.tech.tacticId.replace('TA', 'T')}/`} target="_blank" rel="noreferrer">
                    {node.tech.tactic} <ExternalLink size={10} />
                  </a>
                  <span className="wb-link">
                    <Grid3X3 size={10} /> {ctx.nodes.length} techniques · {ctx.columns.length} tactics in this subset
                  </span>
                </div>
                <div className="wb-footnote">
                  <SimulatedBadge />
                  <span>The matrix is an offline, trimmed subset with demo observation counts; live feeds drive the CVE and asset pages instead.</span>
                </div>
              </Card>
            </>
          )}
        </div>
      </div>
    </>
  )
}

function Card({ title, sub, children }: { title: string; sub?: string; children: ReactNode }) {
  return (
    <section className="wb-card">
      <header className="wb-card-head">
        <div>
          <h3>{title}</h3>
          {sub && <p>{sub}</p>}
        </div>
      </header>
      <div className="wb-card-body">{children}</div>
    </section>
  )
}

function EmptyNote({ title, body }: { title: string; body: string }) {
  return (
    <div className="wb-empty">
      <Info size={15} />
      <div>
        <strong>{title}</strong>
        <p>{body}</p>
      </div>
    </div>
  )
}

function Kv({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span>{label}</span>
      <b className="mono">{value}</b>
    </div>
  )
}

function BarRow({ label, value, max, fill, note }: { label: string; value: number; max: number; fill: string; note: string }) {
  return (
    <div className="wb-bar">
      <span className="wb-bar-label">{label}</span>
      <span className="wb-bar-track">
        <i style={{ width: `${Math.max(2, Math.min(100, (value / Math.max(max, 1)) * 100))}%`, background: fill } as CSSProperties} />
      </span>
      <b>
        {value}
        <span className="wb-bar-max"> {note}</span>
      </b>
    </div>
  )
}

function WeightRow({ label, value, share, fill }: { label: string; value: string; share: number; fill: string }) {
  return (
    <div className="wb-weight-row">
      <span>{label}</span>
      <span className="mkw-weight-track">
        <i style={{ width: `${Math.max(3, Math.min(100, share))}%`, background: fill } as CSSProperties} />
      </span>
      <b>{value}</b>
    </div>
  )
}

function NodeRow({ node, rank, onOpen }: { node: TechniqueNode; rank: number; onOpen: (node: TechniqueNode) => void }) {
  return (
    <button type="button" className="wb-node-row" onClick={() => onOpen(node)}>
      <span className="wb-node-dot" style={{ background: node.severity ? levelColor(node.severity) : '#97a3b4' }} />
      <span className="wb-node-main">
        <strong>{node.tech.name}</strong>
        <span className="mono">
          {node.tech.id} · {node.profiles.length} playbook{node.profiles.length === 1 ? '' : 's'}
        </span>
      </span>
      <span className="mkw-shared mono">#{rank}</span>
      <span className="wb-node-score">{node.tech.observed}</span>
      <ArrowRight size={12} />
    </button>
  )
}

function HandoffCell({
  dir,
  column,
  currentId,
  onOpen,
}: {
  dir: string
  column: TechniqueColumn | null
  currentId: string
  onOpen: (node: TechniqueNode) => void
}) {
  const top = column ? [...column.nodes].sort((a, b) => b.tech.observed - a.tech.observed)[0] : null
  return (
    <div className="mkw-handoff-cell">
      <span className="mkw-handoff-dir mono">{dir}</span>
      {column ? (
        <>
          <strong className="mkw-handoff-tactic">{column.name}</strong>
          {top && top.tech.id !== currentId ? (
            <button type="button" className="mkw-handoff-link" onClick={() => onOpen(top)}>
              loudest: {top.tech.id} · {top.tech.observed} ev <ArrowRight size={11} />
            </button>
          ) : (
            <span className="mkw-handoff-link dim">
              {column.nodes.length} technique{column.nodes.length === 1 ? '' : 's'} · {column.events} ev
            </span>
          )}
        </>
      ) : (
        <span className="mkw-handoff-link dim">end of the rail</span>
      )}
    </div>
  )
}

function PlaybookBlock({
  profile,
  currentId,
  resolve,
  onOpen,
  onProfile,
}: {
  profile: AttackProfile
  currentId: string
  resolve: (id: string) => TechniqueNode | null
  onOpen: (node: TechniqueNode) => void
  onProfile: (key: string) => void
}) {
  const siblings = profile.techniques
    .map((id) => resolve(id))
    .filter((n): n is TechniqueNode => n !== null)
    .filter((n) => n.tech.id !== currentId)
  return (
    <section className="mkw-pb">
      <header className="mkw-pb-head">
        <div>
          <span className="mkw-pb-cat mono">{profile.category}</span>
          <h4>{profile.name}</h4>
        </div>
        <SeverityBadge level={profile.defaultSeverity} />
      </header>
      <p className="mkw-pb-desc">{profile.description}</p>
      <div className="wb-mini-stats">
        <span>
          <b>{profile.techniques.length}</b> techniques
        </span>
        <span>
          <b>{profile.stages.length}</b> stages
        </span>
        <span>
          <b>{profile.mitigations.length}</b> controls
        </span>
        <span>
          <b>{profile.indicators.length}</b> prompts
        </span>
        <span>
          <b>{new Set(profile.mitigations.map((m) => m.team)).size}</b> teams
        </span>
      </div>
      <div className="mkw-pb-grid">
        <div>
          <span className="mkw-label mono">Stages</span>
          {profile.stages.map((stage, i) => (
            <div className="mkw-stage" key={`${profile.key}-${i}`}>
              <em className="mono">{String(i + 1).padStart(2, '0')}</em>
              <div>
                <strong>{stage.tactic}</strong>
                <p>{stage.note}</p>
              </div>
            </div>
          ))}
        </div>
        <div>
          <span className="mkw-label mono">Controls and owners</span>
          {profile.mitigations.map((m) => (
            <div className="mkw-control" key={`${profile.key}-${m.control}`}>
              <strong>{m.control}</strong>
              <span className="mono">{m.team}</span>
            </div>
          ))}
          <span className="mkw-label mono mt">Indicators</span>
          <div className="entity-tags">
            {profile.indicators.map((i) => (
              <span className="entity-tag" key={`${profile.key}-${i}`}>
                {i}
              </span>
            ))}
          </div>
        </div>
      </div>
      <div className="mkw-pb-foot">
        <span className="mkw-label mono">Also in this playbook</span>
        <div className="entity-tags">
          {siblings.map((n) => (
            <button type="button" className="entity-tag mkw-sib" key={n.tech.id} onClick={() => onOpen(n)}>
              {n.tech.id} · {n.tech.name}
            </button>
          ))}
          {!siblings.length && <span className="mkw-handoff-link dim">this technique is the only member</span>}
        </div>
        <button type="button" className="btn btn-ghost btn-sm mkw-pb-open" onClick={() => onProfile(profile.key)}>
          Highlight on the matrix <Crosshair size={11} />
        </button>
      </div>
    </section>
  )
}
