import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Chart, axisStyle } from '../../components/Chart'
import { Panel, PageHeader } from '../../components/Panel'
import AiBriefing from '../../components/AiBriefing'
import { RadialGauge } from '../../components/RadialGauge'
import { SeverityBadge, SourceBadge } from '../../components/Badges'
import { Sparkline } from '../../components/Sparkline'
import { StatsPanel } from '../../components/StatsPanel'
import { ArrowRight, ExternalLink, ShieldAlert, ShieldCheck, Zap } from '../../components/Icons'
import {
  activityHeatmap,
  activeAlerts,
  alertDaily,
  alerts,
  assets as seedAssets,
  counts,
  DEMO_NOW,
  posture,
  suppressedAlerts,
  threatDaily,
} from '../../data/seed'
import { useFilters, useTheme } from '../../lib/store'
import { allUploadedAssets, useUploads } from '../../lib/uploads'
import { fmtInt, fmtScore, timeAgo } from '../../lib/format'
import { median, spearman, stdev, mean } from '../../lib/stats'
import { mlFor, mlPortfolio, MODEL_CARD } from '../../lib/ml'
import { AMBER, LEVEL_COLORS, SUPPRESSED, TEAL, hexA, levelColor } from '../../lib/colors'
import type { Alert, RiskLevel } from '../../lib/types'

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

const WEEKS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export default function Dashboard() {
  const navigate = useNavigate()
  const theme = useTheme((s) => s.theme)
  const query = useFilters((s) => s.query)
  const severity = useFilters((s) => s.severity)

  const uploadDatasets = useUploads((s) => s.datasets)
  const uploadedAssets = useMemo(() => allUploadedAssets(uploadDatasets), [uploadDatasets])
  const inventory = useMemo(() => [...uploadedAssets, ...seedAssets], [uploadedAssets])
  const versioned = inventory.filter((a) => a.software.every((s) => s.version && s.version !== 'unknown')).length
  const coverage = Math.round((versioned / Math.max(1, inventory.length)) * 100)

  const kevActive = activeAlerts.filter((a) => a.cve.kev)
  const exposureActive = activeAlerts.filter((a) => a.asset.internetFacing)
  const criticalAssets = activeAlerts.filter((a) => a.asset.criticality === 'HIGH')

  const levelCounts = (['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as RiskLevel[]).map((level) => ({
    level,
    value: activeAlerts.filter((a) => a.level === level).length,
  }))

  const topAlerts = useMemo(() => {
    const q = query.trim().toLowerCase()
    return activeAlerts
      .filter((a) => (severity === 'ALL' ? true : a.level === severity))
      .filter((a) =>
        q
          ? `${a.cve.id} ${a.cve.title} ${a.asset.name} ${a.asset.department}`.toLowerCase().includes(q)
          : true,
      )
      .slice()
      .sort((a, b) => b.score - a.score)
      .slice(0, 6)
  }, [query, severity])

  const stats = useMemo(() => {
    const scores = activeAlerts.map((a) => a.score)
    const epss = activeAlerts.map((a) => a.cve.epss ?? 0)
    const cvss = activeAlerts.map((a) => a.cve.cvss ?? 0)
    return [
      {
        name: 'Mean risk score',
        value: fmtScore(mean(scores)),
        formula: 'mean(score_i) over active alerts',
        n: scores.length,
      },
      {
        name: 'Median EPSS',
        value: `${(median(epss) * 100).toFixed(1)}%`,
        formula: 'median(epss_i) · 30-day exploitation probability',
        n: epss.length,
      },
      {
        name: 'Score dispersion',
        value: `σ ${fmtScore(stdev(scores))}`,
        formula: 'sample standard deviation of alert scores',
        n: scores.length,
      },
      {
        name: 'CVSS ↔ risk correlation',
        value: spearman(cvss, scores).toFixed(2),
        formula: 'Spearman rank correlation',
        n: scores.length,
        note: 'Asset context reshuffles the severity-only queue.',
      },
      {
        name: 'Suppression rate',
        value: `${((suppressedAlerts.length / alerts.length) * 100).toFixed(1)}%`,
        formula: 'suppressed / all correlation candidates',
        n: alerts.length,
      },
      {
        name: 'Model ↔ score agreement',
        value: spearman(activeAlerts.map((a) => mlFor(a.id).probability), scores).toFixed(2),
        formula: 'Spearman ρ · XGBoost prior vs six-factor score',
        n: scores.length,
        note: `XGBoost v${MODEL_CARD.version} · test AUC ${MODEL_CARD.test.auc.toFixed(3)} on synthetic data.`,
      },
    ]
  }, [])

  const threatOption = useMemo(() => {
    const ax = axisStyle(theme, { split: true })
    return {
      grid: { left: 38, right: 16, top: 34, bottom: 28 },
      xAxis: {
        type: 'category',
        data: threatDaily.map((d) => d.label),
        ...ax,
        axisLabel: { ...ax.axisLabel, interval: 4 },
      },
      yAxis: { type: 'value', ...ax, axisLabel: { ...ax.axisLabel, interval: 5 } },
      tooltip: { trigger: 'axis' },
      series: [
        {
          name: 'New CVEs',
          type: 'line',
          smooth: 0.4,
          symbol: 'none',
          data: threatDaily.map((d) => d.newCves),
          lineStyle: { width: 1.8, color: TEAL },
          areaStyle: {
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: hexA(TEAL, 0.26) },
                { offset: 1, color: hexA(TEAL, 0) },
              ],
            },
          },
        },
        {
          name: 'KEV additions',
          type: 'bar',
          data: threatDaily.map((d) => d.kev),
          barWidth: '32%',
          itemStyle: { color: hexA(AMBER, 0.72), borderRadius: [2, 2, 0, 0] },
        },
      ],
    }
  }, [theme])

  const alertOption = useMemo(() => {
    const ax = axisStyle(theme)
    return {
      grid: { left: 34, right: 14, top: 36, bottom: 26 },
      xAxis: { type: 'category', data: alertDaily.map((d) => d.label), ...ax },
      yAxis: { type: 'value', ...ax, minInterval: 1 },
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
      series: ['critical', 'high', 'medium', 'low'].map((key, i) => ({
        name: key.toUpperCase(),
        type: 'bar',
        stack: 'level',
        barWidth: '52%',
        data: alertDaily.map((d) => (d as unknown as Record<string, number>)[key]),
        itemStyle: {
          color: LEVEL_COLORS[(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as RiskLevel[])[i]],
          borderRadius: i === 3 ? [3, 3, 0, 0] : 0,
        },
      })),
    }
  }, [theme])

  const donutOption = useMemo(() => {
    return {
      tooltip: { trigger: 'item', formatter: '{b}: {c} ({d}%)' },
      title: {
        text: String(counts.active),
        subtext: 'active alerts',
        left: 'center',
        top: '38%',
        textStyle: { fontSize: 34, fontWeight: 500, color: theme === 'dark' ? '#e9eef5' : '#131a23' },
        subtextStyle: { fontSize: 9, color: theme === 'dark' ? '#647184' : '#7d8796', fontFamily: 'monospace' },
      },
      series: [
        {
          type: 'pie',
          radius: ['62%', '84%'],
          center: ['50%', '48%'],
          avoidLabelOverlap: true,
          itemStyle: {
            borderColor: theme === 'dark' ? '#0a1019' : '#fbf9f4',
            borderWidth: 3,
            borderRadius: 4,
          },
          label: { show: false },
          emphasis: { label: { show: false }, scaleSize: 6 },
          data: levelCounts.map((d) => ({
            name: d.level,
            value: d.value,
            itemStyle: { color: LEVEL_COLORS[d.level] },
          })),
        },
      ],
    }
  }, [theme, levelCounts])

  const treemapOption = useMemo(() => {
    const groups: Record<string, typeof activeAlerts> = {}
    activeAlerts.forEach((a) => {
      ;(groups[a.asset.department] ??= []).push(a)
    })
    const children = Object.entries(groups).map(([dept, items]) => {
      const maxLevel = (['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as RiskLevel[]).find((l) =>
        items.some((i) => i.level === l),
      ) ?? 'LOW'
      return {
        name: dept,
        value: items.reduce((sum, i) => sum + 10 + i.score / 10, 0),
        itemStyle: { color: hexA(LEVEL_COLORS[maxLevel], 0.28), borderColor: hexA(LEVEL_COLORS[maxLevel], 0.75) },
        label: { color: '#e9eef5', fontSize: 10, lineHeight: 15 },
        upperLabel: { show: true, height: 20, color: '#98a5b8', fontSize: 8 },
        children: items.map((a) => ({
          name: `${a.asset.name}\n${fmtScore(a.score)}`,
          value: 10 + a.score / 10,
          itemStyle: { color: hexA(LEVEL_COLORS[a.level], 0.55), borderColor: 'rgba(5,8,14,0.7)' },
          label: { color: '#05080e', fontSize: 8.5, fontWeight: 600 },
        })),
      }
    })
    return {
      tooltip: {
        formatter: (p: any) =>
          p.data?.children ? `${p.name}<br/>${p.data.children.length} active alerts` : `${p.name}<br/>weighted exposure`,
      },
      series: [
        {
          type: 'treemap',
          roam: false,
          nodeClick: false,
          breadcrumb: { show: false },
          width: '100%',
          height: '100%',
          top: 4,
          left: 0,
          right: 0,
          bottom: 0,
          itemStyle: { borderWidth: 3, gapWidth: 3, borderColor: 'rgba(5,8,14,0.8)' },
          levels: [
            { itemStyle: { borderWidth: 0, gapWidth: 6 } },
            { itemStyle: { gapWidth: 2 } },
          ],
          data: children,
        },
      ],
    }
  }, [])

  const heatmapOption = useMemo(() => {
    const data: [number, number, number][] = []
    activityHeatmap.forEach((row, day) => row.forEach((v, hour) => data.push([hour, day, v])))
    const ax = axisStyle(theme, { split: false })
    return {
      grid: { left: 42, right: 14, top: 16, bottom: 36 },
      tooltip: {
        formatter: (p: any) =>
          `${WEEKS[p.value[1]]} ${String(p.value[0]).padStart(2, '0')}:00<br/>${p.value[2]} events`,
      },
      xAxis: {
        type: 'category',
        data: Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0')),
        ...ax,
        axisLabel: { ...ax.axisLabel, interval: 2, fontSize: 8 },
      },
      yAxis: {
        type: 'category',
        data: DAY_LABELS,
        ...ax,
        axisLabel: { ...ax.axisLabel, fontSize: 8 },
      },
      visualMap: {
        show: false,
        min: 0,
        max: 50,
        inRange: { color: ['rgba(62,210,193,0.04)', hexA(TEAL, 0.45), hexA(AMBER, 0.75), '#e5545a'] },
      },
      series: [
        {
          type: 'heatmap',
          data,
          itemStyle: { borderRadius: 2, borderWidth: 2, borderColor: theme === 'dark' ? '#080d15' : '#f4f0e8' },
          emphasis: { itemStyle: { borderColor: '#fff' } },
        },
      ],
    }
  }, [theme])

  return (
    <div className="page">
      <PageHeader
        eyebrow={`SECURITY POSTURE · ${DEMO_NOW.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }).toUpperCase()} · DEMO SEED`}
        title="Command centre"
        description="Threats correlated to your inventory, ranked by what could actually reach a system you run."
        actions={
          <>
            {uploadDatasets.length > 0 && (
              <span className="badge upload">{uploadDatasets.length} upload{uploadDatasets.length === 1 ? '' : 's'} applied</span>
            )}
            <button className="btn btn-ghost btn-sm" onClick={() => navigate('/app/scoring')}>
              <Zap size={13} /> Scoring model
            </button>
            <button className="btn btn-primary btn-sm" onClick={() => navigate('/app/alerts')}>
              Review alerts <ArrowRight size={13} />
            </button>
          </>
        }
      />

      <div className="kpi-grid">
        <div className="kpi critical-tone" onClick={() => navigate('/app/alerts')} role="button" tabIndex={0}>
          <div className="kpi-label">
            <ShieldAlert size={11} /> Posture score
          </div>
          <div className="kpi-value">
            {posture}
            <small>/ 100 · higher is better</small>
          </div>
          <div className="kpi-delta up">−8 vs last week</div>
          <div className="kpi-spark">
            <Sparkline values={alertDaily.map((d) => d.critical * 15 + d.high * 6 + 8)} width={60} height={22} color="#e5545a" />
          </div>
        </div>

        <div className="kpi high-tone" onClick={() => navigate('/app/alerts')} role="button" tabIndex={0}>
          <div className="kpi-label">
            <Zap size={11} /> Active alerts
          </div>
          <div className="kpi-value">
            {counts.active}
            <small>of {counts.total} candidates</small>
          </div>
          <div className="kpi-delta">{counts.suppressed} suppressed by relevance</div>
          <div className="kpi-spark">
            <Sparkline values={alertDaily.map((d) => d.critical + d.high + d.medium + d.low + 1)} width={60} height={22} color="#e08a2f" />
          </div>
        </div>

        <div className="kpi critical-tone" onClick={() => navigate('/app/alerts')} role="button" tabIndex={0}>
          <div className="kpi-label">Critical now</div>
          <div className="kpi-value">
            {counts.critical}
            <small>needs patch this window</small>
          </div>
          <div className="kpi-delta up">KEV floor applied to 2</div>
          <div className="kpi-spark">
            <Sparkline values={alertDaily.map((d) => d.critical)} width={60} height={22} color="#e5545a" />
          </div>
        </div>

        <div className="kpi amber-tone" onClick={() => navigate('/app/cves')} role="button" tabIndex={0}>
          <div className="kpi-label">KEV-linked alerts</div>
          <div className="kpi-value">
            {kevActive.length}
            <small>known exploited</small>
          </div>
          <div className="kpi-delta">of {counts.kev} KEV CVEs ingested</div>
          <div className="kpi-spark">
            <Sparkline values={threatDaily.map((d) => d.kev)} width={60} height={22} color="#e3a455" />
          </div>
        </div>

        <div className="kpi teal-tone" onClick={() => navigate('/app/map')} role="button" tabIndex={0}>
          <div className="kpi-label">Internet-facing</div>
          <div className="kpi-value">
            {exposureActive.length}
            <small>exposed assets alerting</small>
          </div>
          <div className="kpi-delta">+5 exposure points each</div>
          <div className="kpi-spark">
            <Sparkline values={[3, 4, 4, 5, 5, 6, 7, exposureActive.length]} width={60} height={22} color="#3ed2c1" />
          </div>
        </div>

        <div className="kpi" onClick={() => navigate('/app/assets')} role="button" tabIndex={0}>
          <div className="kpi-label">
            <ShieldCheck size={11} /> Inventory coverage
          </div>
          <div className="kpi-value">
            {coverage}<small>% · {inventory.length} assets</small>
          </div>
          <div className="kpi-delta down">
            version-aware on {versioned} of {inventory.length}
            {uploadedAssets.length ? ` · ${uploadedAssets.length} uploaded` : ''}
          </div>
          <div className="kpi-spark">
            <Sparkline values={[88, 92, 92, 96, 96, 100, 100, 100]} width={60} height={22} color="#3fae74" />
          </div>
        </div>
      </div>

      <AiBriefing />

      <div className="dash-grid">
        <Panel
          className="col-4 posture-panel"
          title="Posture"
          sub="Exposure index · 4 critical alerts × 15 + 4 high × 6"
          action={<span className="mono">SIMULATED</span>}
          noPad
        >
          <div className="posture-body">
            <RadialGauge value={posture} size={196} stroke={7} color="#e5545a" ticks={52}>
              <div className="posture-center">
                <div className="num">
                  {posture}
                  <small>/100</small>
                </div>
                <div className="label">posture score</div>
                <div className="trend down">▼ 8 pts this week</div>
              </div>
            </RadialGauge>
            <div className="posture-factors">
              <div className="factor-line">
                <span>KEV-active alerts</span>
                <strong>
                  {kevActive.length}
                  <span className="dim"> / {counts.active}</span>
                </strong>
              </div>
              <div className="factor-line">
                <span>Internet-facing</span>
                <strong>
                  {exposureActive.length}
                  <span className="dim"> / {counts.active}</span>
                </strong>
              </div>
              <div className="factor-line">
                <span>High-criticality assets</span>
                <strong>
                  {criticalAssets.length}
                  <span className="dim"> / {counts.active}</span>
                </strong>
              </div>
              <div className="factor-line">
                <span>Suppression precision</span>
                <strong>
                  {suppressedAlerts.length}
                  <span className="dim"> low-value hidden</span>
                </strong>
              </div>
            </div>
          </div>
        </Panel>

        <Panel
          className="col-8"
          title="Threat landscape · 30 days"
          sub="Ingested CVEs and known-exploited additions · demo series"
          action={<span className="badge real">NVD · KEV</span>}
          noPad
        >
          <Chart option={threatOption} height={302} />
          <div className="chart-legend">
            <span className="legend-item">
              <i style={{ background: TEAL }} /> New CVEs
            </span>
            <span className="legend-item">
              <i style={{ background: AMBER }} /> KEV additions
            </span>
            <span className="legend-item dim">Series derived deterministically from seed 20261031</span>
          </div>
        </Panel>

        <Panel
          className="col-8"
          title="Alerts raised · last 8 days"
          sub="Stacked by risk level after the relevance gate"
          action={<button className="panel-link" onClick={() => navigate('/app/alerts')}>Open alert center <ArrowRight size={11} /></button>}
          noPad
        >
          <Chart option={alertOption} height={258} />
          <div className="chart-legend">
            {(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as RiskLevel[]).map((l) => (
              <span className="legend-item" key={l}>
                <i style={{ background: LEVEL_COLORS[l] }} /> {l}
              </span>
            ))}
          </div>
        </Panel>

        <Panel
          className="col-4"
          title="Risk composition"
          sub="Active alerts only · suppression shown separately"
          action={<span className="mono">n={counts.active}</span>}
          noPad
        >
          <Chart option={donutOption} height={258} />
          <div className="chart-legend" style={{ justifyContent: 'center' }}>
            <span className="legend-item">
              <i style={{ background: SUPPRESSED }} /> {counts.suppressed} suppressed not counted
            </span>
          </div>
        </Panel>

        <Panel
          className="col-7"
          title="Asset exposure treemap"
          sub="Area weighted by score · colour by highest risk level"
          action={<button className="panel-link" onClick={() => navigate('/app/assets')}>All assets <ArrowRight size={11} /></button>}
          noPad
        >
          <div style={{ padding: '4px 12px 12px' }}>
            <Chart option={treemapOption} height={284} />
          </div>
        </Panel>

        <Panel
          className="col-5"
          title="Authentication activity"
          sub="Events per hour · 7-day window · simulated logs"
          action={<span className="badge simulated">Simulated</span>}
          noPad
        >
          <Chart option={heatmapOption} height={284} />
        </Panel>

        <Panel
          className="col-12"
          title="Priority queue"
          sub={`${topAlerts.length} of ${activeAlerts.length} active alerts · XGBoost flags ${mlPortfolio.elevated} at ≥35% · sorted by six-factor score`}
          action={
            <button className="panel-link" onClick={() => navigate('/app/alerts')}>
              Full queue <ArrowRight size={11} />
            </button>
          }
          noPad
        >
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th style={{ width: 56 }}>Score</th>
                  <th>Alert</th>
                  <th>Severity</th>
                  <th>Relevance</th>
                  <th className="right">XGB p</th>
                  <th>KEV</th>
                  <th>Source</th>
                  <th className="right">Age</th>
                </tr>
              </thead>
              <tbody>
                {topAlerts.map((a) => (
                  <tr
                    key={a.id}
                    className="clickable"
                    onClick={() => navigate(`/app/alerts?alert=${a.id}`)}
                  >
                    <td>
                      <span className={`score-cell ${a.level.toLowerCase()}`}>{fmtScore(a.score)}</span>
                    </td>
                    <td>
                      <div className="cell-title">
                        {a.cve.id} <span className="dim">·</span> {a.asset.name}
                      </div>
                      <div className="cell-sub">{a.cve.title}</div>
                    </td>
                    <td>
                      <SeverityBadge level={a.level} />
                    </td>
                    <td>
                      <span className="mono" style={{ fontSize: 9.5 }}>
                        {a.relevance === 'MATCHED' ? 'version in range' : 'version unverified'}
                      </span>
                    </td>
                    <td className="right">
                      <MlCell alert={a} />
                    </td>
                    <td>{a.cve.kev ? <span className="badge high">KEV</span> : <span className="dim mono">—</span>}</td>
                    <td>
                      <SourceBadge source="NVD" />
                    </td>
                    <td className="right mono">{timeAgo(a.createdAt, DEMO_NOW)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="table-note">
            <span className="inline-flex">
              <ExternalLink size={11} /> Every score opens its six-factor derivation.
            </span>
            <span className="mono">formula v1.1 · XGBoost v{MODEL_CARD.version} second opinion</span>
          </div>
        </Panel>

        <StatsPanel stats={stats} className="col-12" />
      </div>

      <div className="page-foot">
        <span className="mono">
          Demo window {DEMO_NOW.toISOString().slice(0, 16).replace('T', ' ')}Z · {fmtInt(18)} CVEs · {inventory.length} assets · 15 correlation candidates
        </span>
        <span className="mono">Labels: NVD / CISA KEV / FIRST EPSS = real · SIMULATED = seeded · USER UPLOAD = customer data</span>
      </div>
    </div>
  )
}

function MlCell({ alert }: { alert: Alert }) {
  const { probability, band } = mlFor(alert.id)
  return (
    <div className={`ml-cell ${band.toLowerCase()}${alert.suppressed ? ' gated' : ''}`}>
      <span className="mono ml-cell-value">{(probability * 100).toFixed(0)}%</span>
      <span className="ml-cell-track" aria-hidden="true">
        <i style={{ width: `${Math.max(3, probability * 100)}%` }} />
      </span>
    </div>
  )
}
