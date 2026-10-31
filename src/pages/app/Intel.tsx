import { useMemo, useState } from 'react'
import { Chart, axisStyle } from '../../components/Chart'
import { PageHeader, Panel } from '../../components/Panel'
import { Drawer, DrawerHead } from '../../components/Drawer'
import { StatsPanel } from '../../components/StatsPanel'
import { SourceBadge, LiveDot } from '../../components/Badges'
import { EmptyState } from '../../components/EmptyState'
import { Database, ExternalLink, RefreshCw, Rss, ShieldCheck } from '../../components/Icons'
import { DEMO_NOW, intelItems, sourceHealth } from '../../data/seed'
import { useTheme } from '../../lib/store'
import { latestLiveFetch, useLiveFeeds, type LiveSource } from '../../lib/liveFeeds'
import { fmtInt, fmtDate, fmtDateTime, timeAgo } from '../../lib/format'
import { AMBER, SIMULATED, TEAL, hexA } from '../../lib/colors'
import type { IntelItem } from '../../lib/types'

const SOURCES = ['ALL', 'NVD', 'CISA KEV', 'FIRST EPSS', 'MITRE ATT&CK', 'CERT-In'] as const

const LIVE_SOURCE_KEYS: Record<string, LiveSource | undefined> = {
  NVD: 'NVD',
  'CISA KEV': 'CISA KEV',
  'FIRST EPSS': 'FIRST EPSS',
}

export default function Intel() {
  const theme = useTheme((s) => s.theme)
  const [source, setSource] = useState<(typeof SOURCES)[number]>('ALL')
  const [selected, setSelected] = useState<IntelItem | null>(null)
  const syncing = useLiveFeeds((s) => s.syncing)
  const syncPhase = useLiveFeeds((s) => s.phase)
  const liveMeta = useLiveFeeds((s) => s.meta)
  const syncAll = useLiveFeeds((s) => s.syncAll)
  const lastLive = latestLiveFetch(liveMeta)

  const filtered = intelItems.filter((i) => (source === 'ALL' ? true : i.source === source))
  const realItems = intelItems.filter((i) => !i.simulated)
  const simulatedItems = intelItems.filter((i) => i.simulated)

  const timelineOption = useMemo(() => {
    const buckets = Array.from({ length: 12 }, (_, i) => {
      const start = DEMO_NOW.getTime() - (11 - i) * 8 * 3600 * 1000
      const end = start + 8 * 3600 * 1000
      const items = intelItems.filter((it) => {
        const t = new Date(it.published).getTime()
        return t >= start && t < end
      })
      const d = new Date(start + 4 * 3600 * 1000)
      return {
        label: d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', hour12: false }),
        real: items.filter((x) => !x.simulated).length,
        simulated: items.filter((x) => x.simulated).length,
      }
    })
    const ax = axisStyle(theme)
    return {
      grid: { left: 32, right: 14, top: 24, bottom: 34 },
      xAxis: { type: 'category', data: buckets.map((b) => b.label), ...ax, axisLabel: { ...ax.axisLabel, fontSize: 7.5, rotate: 30 } },
      yAxis: { type: 'value', ...ax, minInterval: 1 },
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      series: [
        {
          name: 'Real public source',
          type: 'bar',
          stack: 's',
          data: buckets.map((b) => b.real),
          barWidth: '54%',
          itemStyle: { color: hexA(TEAL, 0.75), borderRadius: [0, 0, 0, 0] },
        },
        {
          name: 'Simulated / sample',
          type: 'bar',
          stack: 's',
          data: buckets.map((b) => b.simulated),
          itemStyle: { color: hexA(SIMULATED, 0.75), borderRadius: [3, 3, 0, 0] },
        },
      ],
    }
  }, [theme])

  const volumeOption = useMemo(() => {
    const ax = axisStyle(theme)
    const rows = [...sourceHealth].sort((a, b) => a.records - b.records)
    return {
      grid: { left: 106, right: 46, top: 12, bottom: 20 },
      xAxis: { type: 'log', min: 1, ...ax, axisLabel: { ...ax.axisLabel, fontSize: 8, formatter: (v: number) => fmtInt(v) } },
      yAxis: { type: 'category', data: rows.map((r) => r.source), ...ax, splitLine: { show: false }, axisLabel: { ...ax.axisLabel, fontSize: 9 } },
      tooltip: { formatter: (p: any) => `${p.name}<br/>${fmtInt(p.value)} records` },
      series: [
        {
          type: 'bar',
          barWidth: '54%',
          data: rows.map((r) => ({
            value: r.records,
            itemStyle: {
              color: r.kind === 'simulated' ? hexA(SIMULATED, 0.75) : hexA(TEAL, 0.75),
              borderRadius: [0, 3, 3, 0],
            },
          })),
          label: {
            show: true,
            position: 'right',
            color: theme === 'dark' ? '#98a5b8' : '#596474',
            fontSize: 8,
            fontFamily: 'monospace',
            formatter: (p: any) => fmtInt(p.value),
          },
        },
      ],
    }
  }, [theme])

  const freshness = sourceHealth.map((s) => {
    const key = LIVE_SOURCE_KEYS[s.source]
    const live = key ? liveMeta[key] : undefined
    return {
      ...s,
      status: live ? (live.status === 'ok' ? 'OK' : 'DEGRADED') : s.status,
      lastSuccess: live?.fetchedAt ?? s.lastSuccess,
      live: Boolean(live),
      age: live
        ? (Date.now() - new Date(live.fetchedAt).getTime()) / 3600000
        : (DEMO_NOW.getTime() - new Date(s.lastSuccess).getTime()) / 3600000,
    }
  })
  const freshMedian = [...freshness].map((f) => f.age).sort((a, b) => a - b)[Math.floor(freshness.length / 2)]

  return (
    <div className="page">
      <PageHeader
        eyebrow="COMPONENT 08 · THREAT INTEL FEED"
        title="Intelligence with receipts"
        description="Every item carries its source, its timestamp, and a visible distinction between real public feeds and demonstration content."
        actions={
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => void syncAll({ force: true })}
            disabled={syncing}
            aria-busy={syncing}
          >
            <RefreshCw size={13} className={syncing ? 'spin' : undefined} />
            {syncing ? `Syncing ${syncPhase ?? ''}` : 'Sync live feeds'}
          </button>
        }
      />

      <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(4, minmax(0,1fr))' }}>
        <div className="kpi teal-tone">
          <div className="kpi-label">Real public sources</div>
          <div className="kpi-value">3</div>
          <div className="kpi-delta">NVD · CISA KEV · FIRST EPSS</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Items in window</div>
          <div className="kpi-value">{intelItems.length}</div>
          <div className="kpi-delta">{realItems.length} real · {simulatedItems.length} simulated</div>
        </div>
        <div className="kpi amber-tone">
          <div className="kpi-label">Median source age</div>
          <div className="kpi-value">
            {freshMedian.toFixed(1)}
            <small>h</small>
          </div>
          <div className="kpi-delta">time since last successful pull</div>
        </div>
        <div className="kpi high-tone">
          <div className="kpi-label">Degraded sources</div>
          <div className="kpi-value">{freshness.filter((s) => s.status !== 'OK').length}</div>
          <div className="kpi-delta">live pull errors and sample feeds</div>
        </div>
      </div>

      <div className="dash-grid">
        <Panel
          className="col-8"
          title="Source health"
          sub="Last successful update · record counts · provenance class"
          action={
            <span className={lastLive ? 'badge real' : 'badge simulated'}>
              {lastLive ? `live ${timeAgo(lastLive)}` : 'seed snapshot'}
            </span>
          }
          noPad
        >
          <div style={{ padding: '14px 18px', display: 'grid', gap: 8 }}>
            {freshness.map((s) => (
              <div key={s.source} className="source-row">
                <div style={{ minWidth: 120 }}>
                  <div className="inline-flex" style={{ gap: 8 }}>
                    <i
                      className="status-dot"
                      style={{
                        background: s.status === 'OK' ? 'var(--teal)' : s.status === 'DEGRADED' ? 'var(--amber)' : 'var(--simulated)',
                      }}
                    />
                    <strong style={{ fontSize: 12 }}>{s.source}</strong>
                  </div>
                  <div className="mono" style={{ marginTop: 3, fontSize: 8 }}>
                    {s.note}
                    {s.live ? ' · browser pull' : ''}
                  </div>
                </div>
                <div className="source-bar">
                  <div
                    style={{
                      width: `${Math.min(100, (s.records / 241903) * 100)}%`,
                      background: s.kind === 'simulated' ? hexA(SIMULATED, 0.65) : hexA(TEAL, 0.65),
                    }}
                  />
                </div>
                <div className="mono" style={{ textAlign: 'right', fontSize: 9 }}>
                  {fmtInt(s.records)} rec.
                </div>
                <div className="mono" style={{ textAlign: 'right', fontSize: 9, color: s.age > 24 ? 'var(--amber)' : 'var(--text-mute)' }}>
                  {s.age.toFixed(1)}h
                </div>
                <SourceBadge source={s.source} simulated={s.kind === 'simulated'} />
              </div>
            ))}
          </div>
          <div className="table-note" style={{ borderTop: '1px solid var(--line)' }}>
            <span className="inline-flex">
              <ShieldCheck size={11} /> NVD, KEV and EPSS show the last browser pull; sample sources stay on the demo clock.
            </span>
            <span className="mono">
              {lastLive ? `last pull ${fmtDateTime(lastLive)}` : `demo clock ${DEMO_NOW.toISOString().slice(11, 16)}Z`}
            </span>
          </div>
        </Panel>

        <Panel className="col-4" title="Feed volume" sub="Records currently held per source (log scale)" noPad>
          <Chart option={volumeOption} height={286} />
          <div className="chart-legend" style={{ justifyContent: 'center' }}>
            <span className="legend-item">
              <i style={{ background: TEAL }} /> real
            </span>
            <span className="legend-item">
              <i style={{ background: SIMULATED }} /> simulated subset
            </span>
          </div>
        </Panel>

        <Panel className="col-12" title="Ingestion timeline" sub="Items per 8-hour bucket · stacked by provenance class" noPad>
          <Chart option={timelineOption} height={220} />
        </Panel>

        <Panel
          className="col-12"
          title="Intelligence stream"
          sub={`${filtered.length} items · ${source === 'ALL' ? 'all sources' : source}`}
          action={
            <span className={lastLive ? 'badge real' : 'badge simulated'}>
              {lastLive ? 'Live pull · cached' : 'Demo stream'}
            </span>
          }
          noPad
        >
          <div className="filters-bar">
            <div className="seg">
              {SOURCES.map((s) => (
                <button key={s} className={source === s ? 'on' : undefined} onClick={() => setSource(s)}>
                  {s === 'ALL' ? 'All sources' : s}
                </button>
              ))}
            </div>
            <div className="filters-spacer" />
            <LiveDot label={lastLive ? 'browser cache' : 'offline cache'} />
          </div>
          {filtered.length === 0 ? (
            <EmptyState title="No items from this source" />
          ) : (
            <div className="intel-list">
              {filtered.map((item) => (
                <button key={item.id} className="intel-item" onClick={() => setSelected(item)}>
                  <div className="intel-rail">
                    <i style={{ background: item.simulated ? SIMULATED : TEAL }} />
                  </div>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div className="inline-flex" style={{ flexWrap: 'wrap', gap: 7 }}>
                      <SourceBadge source={item.source} simulated={item.simulated} />
                      <span className="mono" style={{ fontSize: 8 }}>{item.category}</span>
                    </div>
                    <div className="intel-title">{item.title}</div>
                    <div className="intel-summary">{item.summary}</div>
                  </div>
                  <div className="mono" style={{ fontSize: 8.5, whiteSpace: 'nowrap', color: 'var(--text-mute)' }}>
                    {timeAgo(item.published, DEMO_NOW)}
                  </div>
                </button>
              ))}
            </div>
          )}
          <div className="table-note">
            <span className="inline-flex">
              <Rss size={11} /> Real feed items link to their public source. Sample items are marked SIMULATED.
            </span>
            <span className="mono">n={filtered.length}</span>
          </div>
        </Panel>

        <StatsPanel
          className="col-12"
          stats={[
            { name: 'Items per source', value: (intelItems.length / 5).toFixed(1), formula: 'items ÷ 5 sources', n: intelItems.length },
            { name: 'Real-data share', value: `${((realItems.length / intelItems.length) * 100).toFixed(1)}%`, formula: 'real ÷ all items', n: intelItems.length },
            { name: 'Simulated share', value: `${((simulatedItems.length / intelItems.length) * 100).toFixed(1)}%`, formula: 'simulated ÷ all items', n: intelItems.length },
            { name: 'Oldest item', value: `${Math.max(...intelItems.map((i) => (DEMO_NOW.getTime() - new Date(i.published).getTime()) / 3600000)).toFixed(0)}h`, formula: 'max age in window', n: intelItems.length },
            { name: 'Records held', value: fmtInt(sourceHealth.reduce((a, b) => a + b.records, 0)), formula: 'sum of per-source record counts', n: sourceHealth.length },
          ]}
        />
      </div>

      <Drawer open={Boolean(selected)} onClose={() => setSelected(null)} label="Intelligence item">
        {selected && (
          <>
            <DrawerHead
              overline={`${selected.id} · ${selected.category.toUpperCase()}`}
              title={selected.title}
              onClose={() => setSelected(null)}
              meta={
                <span className="inline-flex" style={{ gap: 8, flexWrap: 'wrap' }}>
                  <SourceBadge source={selected.source} simulated={selected.simulated} />
                  <span className="mono" style={{ fontSize: 9 }}>{fmtDate(selected.published)}</span>
                </span>
              }
            />
            <div className="drawer-body">
              <div className="drawer-section">
                <p style={{ fontSize: 13, lineHeight: 1.7, color: 'var(--text)' }}>{selected.summary}</p>
              </div>
              <div className="drawer-section">
                <h3>Provenance</h3>
                <div className="provenance-list">
                  <div className="provenance-row">
                    <span className="check">✓</span>
                    <span>Source</span>
                    <span className="time">{selected.source}</span>
                  </div>
                  <div className="provenance-row">
                    <span className="check">✓</span>
                    <span>Published</span>
                    <span className="time">{new Date(selected.published).toLocaleString('en-US')}</span>
                  </div>
                  <div className="provenance-row">
                    <Database size={12} className="check" />
                    <span>Stored as</span>
                    <span className="time">cached feed item · {selected.simulated ? 'SIMULATED sample' : 'real public record'}</span>
                  </div>
                </div>
              </div>
              {selected.url && (
                <div className="drawer-section">
                  <h3>Original source</h3>
                  <a href={selected.url} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm">
                    Open public record <ExternalLink size={12} />
                  </a>
                </div>
              )}
              <div className="drawer-section">
                <h3>What it changes in Aegis</h3>
                <p style={{ fontSize: 12, color: 'var(--text-dim)' }}>
                  {selected.source === 'NVD'
                    ? 'NVD enrichment refreshes the affected range used by the version-aware gate.'
                    : selected.source === 'CISA KEV'
                      ? 'A KEV addition adds the 10-point exploitation weight and can raise the minimum level for matched alerts.'
                      : selected.source === 'FIRST EPSS'
                        ? 'EPSS updates shift the exploitation component without touching asset context.'
                        : selected.category === 'Adversary behaviour'
                          ? 'ATT&CK mappings connect observed behaviour to techniques shown in the matrix.'
                          : 'Sample advisory content exercises the CERT-In adapter with clearly fake identifiers.'}
                </p>
              </div>
            </div>
          </>
        )}
      </Drawer>
    </div>
  )
}
