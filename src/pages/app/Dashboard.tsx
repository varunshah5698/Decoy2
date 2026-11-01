import { useMemo, useState, type CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'
import { Chart, axisStyle, chartFont, chartTokens } from '../../components/Chart'
import { Panel } from '../../components/Panel'
import AiBriefing from '../../components/AiBriefing'
import { SeverityBadge, SourceBadge } from '../../components/Badges'
import { StatsPanel } from '../../components/StatsPanel'
import { Counter } from '../../components/Counter'
import { McHead, MoonGauge } from '../../components/MoonCards'
import { AttackChain } from '../../components/AttackChain'
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BarChart3,
  CircleDot,
  ExternalLink,
  Globe2,
  ShieldAlert,
  ShieldCheck,
  Zap,
} from '../../components/Icons'
import {
  activityHeatmap,
  DEMO_NOW,
  threatDaily,
} from '../../data/seed'
import {
  useLiveActiveAlerts,
  useLiveAlerts,
  useLiveCounts,
  useLiveMl,
  useLivePosture,
  useLiveSuppressedAlerts,
} from '../../lib/liveData'
import { useFilters, useTheme } from '../../lib/store'
import { openActionCount, useActions } from '../../lib/actionStore'
import { buildRecommendations } from '../../lib/warnings'
import { useUploads } from '../../lib/uploads'
import { useLoginCapture } from '../../lib/loginFeed'
import { PORTAL_HOME } from '../../lib/loginIntel'
import { useScopedInventory, useScopeInfo } from '../../lib/dataScope'
import { cx, fmtInt, fmtScore, plural, timeAgo } from '../../lib/format'
import { median, spearman, stdev, mean } from '../../lib/stats'
import { predict, ML_BANDS, MODEL_CARD } from '../../lib/ml'
import { exposureDeduction } from '../../lib/scoring'
import { AMBER, LEVEL_COLORS, SUPPRESSED, TEAL, hexA, levelColor } from '../../lib/colors'
import type { Alert, RiskLevel } from '../../lib/types'

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const SEVERITIES: RiskLevel[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']

export default function Dashboard() {
  const navigate = useNavigate()
  const theme = useTheme((s) => s.theme)
  const query = useFilters((s) => s.query)
  const severity = useFilters((s) => s.severity)
  const [range, setRange] = useState<7 | 14 | 30>(30)

  const alerts = useLiveAlerts()
  const activeAlerts = useLiveActiveAlerts()
  const suppressedAlerts = useLiveSuppressedAlerts()
  const counts = useLiveCounts()
  const actionEntries = useActions((s) => s.entries)
  const openActions = useMemo(
    () => openActionCount(buildRecommendations(alerts), actionEntries),
    [alerts, actionEntries],
  )
  const posture = useLivePosture()
  const liveMl = useLiveMl()

  const uploadDatasets = useUploads((s) => s.datasets)
  const login = useLoginCapture()
  const inventory = useScopedInventory()
  const scopeInfo = useScopeInfo()
  const portalUrl = PORTAL_HOME
  const loginLive = login.status === 'live'
  const loginFailed = login.failed > 0
  const versioned = inventory.filter((a) => a.software.every((s) => s.version && s.version !== 'unknown')).length
  const coverage = Math.round((versioned / Math.max(1, inventory.length)) * 100)

  const kevActive = activeAlerts.filter((a) => a.cve.kev)
  const exposureActive = activeAlerts.filter((a) => a.asset.internetFacing)

  const levelCounts = SEVERITIES.map((level) => ({
    level,
    value: activeAlerts.filter((a) => a.level === level).length,
  }))

  const severityShares = levelCounts.map((l) => ({
    ...l,
    share: (l.value / Math.max(1, counts.active)) * 100,
  }))

  const gaugeColors =
    theme === 'dark'
      ? ['#ff6a36', '#a9c2da', '#6f8499', '#465b70']
      : ['#ff5a1f', '#14263e', '#8d99a8', '#c0c7d0']

  const deduction = exposureDeduction(counts)

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
  }, [query, severity, activeAlerts])

  const topCritical = useMemo(
    () =>
      activeAlerts
        .filter((a) => a.level === 'CRITICAL' || a.level === 'HIGH')
        .slice()
        .sort((a, b) => b.score - a.score)
        .slice(0, 5),
    [activeAlerts],
  )

  const funnelStages = useMemo(
    () => [
      { name: 'Ingested', value: counts.cves, color: TEAL, note: 'CVE records normalised from NVD · KEV · EPSS' },
      { name: 'Correlated', value: counts.total, color: '#4fb9c9', note: 'Version-aware candidates that touch the inventory' },
      { name: 'Active', value: counts.active, color: AMBER, note: 'Survives the relevance gate · suppressed noise removed' },
      { name: 'High/Crit', value: counts.high + counts.critical, color: LEVEL_COLORS.HIGH, note: 'High and critical after six-factor scoring' },
      { name: 'Critical', value: counts.critical, color: LEVEL_COLORS.CRITICAL, note: 'Patch this window · KEV floor applied' },
    ],
    [counts],
  )

  const peakActivity = useMemo(() => {
    let day = 0
    let hour = 0
    let value = -1
    activityHeatmap.forEach((row, d) =>
      row.forEach((v, h) => {
        if (v > value) {
          value = v
          day = d
          hour = h
        }
      }),
    )
    return { day, hour, value }
  }, [])

  const stats = useMemo(() => {
    const scores = activeAlerts.map((a) => a.score)
    const epss = activeAlerts.map((a) => a.cve.epss ?? 0)
    const cvss = activeAlerts.map((a) => a.cve.cvss ?? 0)
    const medianEpss = median(epss)
    const dispersion = stdev(scores)
    const cvssCorr = spearman(cvss, scores)
    const modelCorr = spearman(activeAlerts.map((a) => predict(a).probability), scores)
    const suppressionRate = alerts.length ? (suppressedAlerts.length / alerts.length) * 100 : null
    return [
      {
        name: 'Mean risk score',
        value: scores.length ? fmtScore(mean(scores)) : '—',
        formula: 'mean(score_i) over active alerts',
        n: scores.length,
      },
      {
        name: 'Median EPSS',
        value: Number.isFinite(medianEpss) ? `${(medianEpss * 100).toFixed(1)}%` : '—',
        formula: 'median(epss_i) · 30-day exploitation probability',
        n: epss.length,
      },
      {
        name: 'Score dispersion',
        value: Number.isFinite(dispersion) ? `σ ${fmtScore(dispersion)}` : '—',
        formula: 'sample standard deviation of alert scores',
        n: scores.length,
      },
      {
        name: 'CVSS ↔ risk correlation',
        value: cvssCorr ? cvssCorr.toFixed(2) : '—',
        formula: 'Spearman rank correlation',
        n: scores.length,
        note: 'Asset context reshuffles the severity-only queue.',
      },
      {
        name: 'Suppression rate',
        value: suppressionRate == null ? '—' : `${suppressionRate.toFixed(1)}%`,
        formula: 'suppressed / all correlation candidates',
        n: alerts.length,
      },
      {
        name: 'Model ↔ score agreement',
        value: modelCorr ? modelCorr.toFixed(2) : '—',
        formula: 'Spearman ρ · XGBoost prior vs six-factor score',
        n: scores.length,
        note: `XGBoost v${MODEL_CARD.version} · test AUC ${MODEL_CARD.test.auc.toFixed(3)} on live NVD/EPSS feeds.`,
      },
    ]
  }, [activeAlerts, suppressedAlerts, alerts])

  const threatOption = useMemo(() => {
    const ax = axisStyle(theme, { split: true })
    const t = chartTokens(theme)
    const series = threatDaily.slice(-range)
    const values = series.map((d) => d.newCves)
    const avg = values.reduce((a, b) => a + b, 0) / Math.max(1, values.length)
    const line = theme === 'dark' ? '#ff8a5c' : '#ff5a1f'
    const bar = theme === 'dark' ? '#a9c2da' : '#14263e'
    const tipBg = theme === 'dark' ? 'rgba(12,18,30,0.97)' : '#14263e'
    const interval = range <= 7 ? 0 : range <= 14 ? 2 : 4
    return {
      grid: { left: 40, right: 34, top: 36, bottom: 28 },
      xAxis: {
        type: 'category',
        data: series.map((d) => d.label),
        ...ax,
        axisLabel: { ...ax.axisLabel, interval, fontSize: 9.5 },
        axisPointer: { label: { show: false } },
      },
      yAxis: { type: 'value', ...ax, splitNumber: 4, axisLabel: { ...ax.axisLabel, fontSize: 9.5 } },
      tooltip: {
        trigger: 'axis',
        backgroundColor: tipBg,
        borderWidth: 0,
        padding: [10, 12],
        textStyle: { color: '#ffffff', fontSize: 10.5, fontFamily: chartFont, lineHeight: 18 },
        extraCssText: 'border-radius:12px;box-shadow:0 20px 40px -18px rgba(16,24,40,.45);',
        axisPointer: {
          type: 'cross',
          lineStyle: { color: hexA(line, 0.45), width: 1, type: 'dashed' },
          crossStyle: { color: hexA(line, 0.45), width: 1, type: 'dashed' },
          label: { show: false },
        },
        formatter: (params: any[]) => {
          const i = params[0]?.dataIndex ?? 0
          const d = series[i]
          return `<div style="font-weight:600;margin-bottom:6px">${d.label}</div>
            <div style="display:flex;gap:16px;justify-content:space-between"><span>New CVEs</span><b>${d.newCves}</b></div>
            <div style="display:flex;gap:16px;justify-content:space-between"><span>KEV additions</span><b>${d.kev}</b></div>`
        },
      },
      series: [
        {
          name: 'KEV additions',
          type: 'bar',
          data: series.map((d) => d.kev),
          barWidth: '38%',
          z: 1,
          itemStyle: { borderRadius: [6, 6, 0, 0], color: hexA(bar, theme === 'dark' ? 0.42 : 0.18) },
          emphasis: { itemStyle: { color: hexA(bar, theme === 'dark' ? 0.7 : 0.35) } },
          animationDelay: (idx: number) => idx * 18,
        },
        {
          name: 'New CVEs',
          type: 'line',
          smooth: 0.42,
          symbol: 'circle',
          showSymbol: false,
          symbolSize: 6,
          data: values,
          z: 3,
          lineStyle: { width: 2.4, color: line, shadowBlur: 14, shadowColor: hexA(line, 0.35) },
          itemStyle: { color: line, borderColor: theme === 'dark' ? '#0e1522' : '#ffffff', borderWidth: 2 },
          areaStyle: {
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: hexA(line, 0.28) },
                { offset: 0.6, color: hexA(line, 0.08) },
                { offset: 1, color: hexA(line, 0) },
              ],
            },
          },
          emphasis: { focus: 'series', lineStyle: { width: 2.8 } },
          markLine: {
            silent: true,
            symbol: 'none',
            lineStyle: { color: hexA(t.muted, 0.55), type: 'dashed', width: 1 },
            label: {
              formatter: `avg ${avg.toFixed(1)}`,
              position: 'insideEndTop',
              color: t.muted,
              fontSize: 8,
              fontFamily: chartFont,
            },
            data: [{ yAxis: avg }],
          },
          markPoint: {
            symbol: 'circle',
            symbolSize: 7,
            itemStyle: { color: line, borderColor: hexA(line, 0.24), borderWidth: 6 },
            label: { show: false },
            data: [{ type: 'max' }],
          },
        },
      ],
    }
  }, [theme, range])


  const funnelOption = useMemo(() => {
    const t = chartTokens(theme)
    const bg = theme === 'dark' ? '#0a1019' : '#fbf9f4'
    const ink = theme === 'dark' ? '#ffffff' : '#10161f'
    const inkDim = theme === 'dark' ? 'rgba(255,255,255,0.88)' : 'rgba(10,16,25,0.72)'
    const top = funnelStages[0].value
    return {
      tooltip: {
        trigger: 'item',
        formatter: (p: any) => {
          const d = p.data ?? {}
          const share = ((d.value / Math.max(1, top)) * 100).toFixed(0)
          return `<b>${d.name}</b><br/><b>${d.value}</b> records · ${share}% of ingested<br/><span style="color:${t.muted}">${d.note ?? ''}</span>`
        },
      },
      series: [
        {
          type: 'funnel',
          left: '8%',
          right: '8%',
          top: 10,
          bottom: 10,
          min: 0,
          max: top,
          minSize: '26%',
          maxSize: '100%',
          sort: 'descending',
          gap: 5,
          label: {
            show: true,
            position: 'inside',
            textBorderWidth: 0,
            textShadowBlur: 0,
            formatter: (p: any) => `{name|${String(p.name).toUpperCase()}}\n{value|${p.value}}`,
            rich: {
              name: {
                fontSize: 8.5,
                fontFamily: chartFont,
                fontWeight: 600,
                color: inkDim,
                letterSpacing: 1.8,
                lineHeight: 15,
                textBorderWidth: 0,
                textShadowBlur: 0,
              },
              value: {
                fontSize: 18,
                fontFamily: "'Space Grotesk Variable', 'Inter Variable', sans-serif",
                fontWeight: 600,
                color: ink,
                lineHeight: 22,
                textBorderWidth: 0,
                textShadowBlur: 0,
              },
            },
          },
          labelLine: { show: false },
          itemStyle: {
            borderColor: bg,
            borderWidth: 2,
            borderRadius: 7,
            shadowBlur: 12,
            shadowColor: 'rgba(0,0,0,.28)',
          },
          emphasis: {
            itemStyle: { shadowBlur: 24, shadowColor: 'rgba(0,0,0,.4)' },
          },
          animationDuration: 1200,
          animationEasing: 'cubicOut',
          data: funnelStages.map((s) => ({
            name: s.name,
            value: s.value,
            note: s.note,
            itemStyle: {
              color: {
                type: 'linear',
                x: 0,
                y: 0,
                x2: 1,
                y2: 0,
                colorStops: [
                  { offset: 0, color: hexA(s.color, 0.96) },
                  { offset: 1, color: hexA(s.color, 0.56) },
                ],
              },
            },
          })),
        },
      ],
    }
  }, [funnelStages, theme])

  const donutOption = useMemo(() => {
    const bg = theme === 'dark' ? '#0e1522' : '#ffffff'
    const ink = theme === 'dark' ? '#eef2f9' : '#101a33'
    const mute = theme === 'dark' ? '#8b93a8' : '#8b91a7'
    return {
      tooltip: { trigger: 'item', formatter: '{b}<br/><b>{c}</b> active · {d}%' },
      title: {
        text: String(counts.active),
        subtext: 'active alerts',
        left: 'center',
        top: '34%',
        textStyle: { fontSize: 36, fontWeight: 600, color: ink, fontFamily: "'Space Grotesk Variable', 'Inter Variable', sans-serif" },
        subtextStyle: { fontSize: 8.5, color: mute, fontFamily: chartFont },
      },
      series: [
        {
          type: 'pie',
          radius: ['58%', '80%'],
          center: ['50%', '46%'],
          startAngle: 90,
          minAngle: 8,
          padAngle: 3,
          label: { show: false },
          labelLine: { show: false },
          itemStyle: {
            borderColor: bg,
            borderWidth: 3,
            borderRadius: 8,
            shadowBlur: 10,
            shadowColor: 'rgba(20,28,58,.12)',
          },
          emphasis: {
            scaleSize: 7,
            itemStyle: { shadowBlur: 24, shadowColor: 'rgba(20,28,58,.2)' },
          },
          animationType: 'scale',
          animationEasing: 'cubicOut',
          animationDuration: 1000,
          data: levelCounts
            .filter((d) => d.value > 0)
            .map((d) => ({
              name: d.level,
              value: d.value,
              itemStyle: { color: gaugeColors[SEVERITIES.indexOf(d.level)] },
            })),
        },
      ],
    }
  }, [theme, levelCounts, counts.active])

  const treemapOption = useMemo(() => {
    const groups: Record<string, typeof activeAlerts> = {}
    activeAlerts.forEach((a) => {
      ;(groups[a.asset.department] ??= []).push(a)
    })
    const bg = theme === 'dark' ? 'rgba(5,8,14,0.85)' : 'rgba(244,240,232,0.9)'
    const textColor = theme === 'dark' ? '#f4f8fd' : '#0b1119'
    const groupText = theme === 'dark' ? '#98a5b8' : '#596474'
    const shade = (color: string, top: number, bottom: number) => ({
      type: 'linear',
      x: 0,
      y: 0,
      x2: 1,
      y2: 1,
      colorStops: [
        { offset: 0, color: hexA(color, top) },
        { offset: 1, color: hexA(color, bottom) },
      ],
    })
    const children = Object.entries(groups).map(([dept, items]) => {
      const maxLevel =
        SEVERITIES.find((l) => items.some((i) => i.level === l)) ?? 'LOW'
      const color = LEVEL_COLORS[maxLevel]
      return {
        name: dept,
        value: items.reduce((sum, i) => sum + 10 + i.score / 10, 0),
        itemStyle: { color: shade(color, 0.24, 0.08), borderColor: bg },
        label: { color: groupText, fontSize: 9.5, fontWeight: 600 },
        upperLabel: {
          show: true,
          height: 22,
          color: groupText,
          fontSize: 8.5,
          fontFamily: chartFont,
          padding: [5, 9, 0, 9],
        },
        children: items.map((a) => ({
          name: `${a.asset.name}\n${fmtScore(a.score)}`,
          value: 10 + a.score / 10,
          asset: a.asset.name,
          cve: a.cve.id,
          level: a.level,
          score: a.score,
          department: dept,
          itemStyle: {
            color: shade(LEVEL_COLORS[a.level], 0.72, 0.36),
            borderColor: bg,
          },
          label: {
            color: textColor,
            fontSize: 9,
            lineHeight: 13,
            overflow: 'truncate',
            ellipsis: '…',
            textShadowColor: 'rgba(0,0,0,.35)',
            textShadowBlur: 4,
          },
        })),
      }
    })
    return {
      tooltip: {
        formatter: (p: any) => {
          const d = p.data ?? {}
          if (d.children) {
            return `<b>${p.name}</b><br/>${d.children.length} active alert${d.children.length === 1 ? '' : 's'}<br/>weighted exposure ${fmtScore(p.value)}`
          }
          return `<b>${d.asset ?? p.name}</b><br/>${d.cve ?? ''} · ${d.level ?? ''}<br/>score ${fmtScore(d.score ?? 0)} · ${d.department ?? ''}`
        },
      },
      series: [
        {
          type: 'treemap',
          roam: false,
          nodeClick: false,
          breadcrumb: { show: false },
          width: '100%',
          height: '100%',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          visibleMin: 200,
          animationDuration: 1000,
          animationEasing: 'quinticOut',
          itemStyle: { borderWidth: 2, gapWidth: 2, borderColor: bg },
          emphasis: {
            focus: 'self',
            itemStyle: {
              borderColor: theme === 'dark' ? 'rgba(255,255,255,.6)' : 'rgba(10,16,25,.4)',
              borderWidth: 1,
              shadowBlur: 18,
              shadowColor: 'rgba(0,0,0,.55)',
            },
          },
          levels: [
            { itemStyle: { borderWidth: 0, gapWidth: 6 } },
            { itemStyle: { gapWidth: 2 } },
          ],
          data: children,
        },
      ],
    }
  }, [theme, activeAlerts])

  const heatmapOption = useMemo(() => {
    const data: [number, number, number][] = []
    activityHeatmap.forEach((row, day) => row.forEach((v, hour) => data.push([hour, day, v])))
    const ax = axisStyle(theme, { split: false })
    const t = chartTokens(theme)
    const bg = theme === 'dark' ? '#080d15' : '#f4f0e8'
    return {
      grid: { left: 42, right: 18, top: 16, bottom: 44 },
      tooltip: {
        formatter: (p: any) =>
          `<b>${DAY_LABELS[p.value[1]]} ${String(p.value[0]).padStart(2, '0')}:00</b><br/>${p.value[2]} events · simulated`,
      },
      xAxis: {
        type: 'category',
        data: Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0')),
        ...ax,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { ...ax.axisLabel, interval: 3, fontSize: 8.5 },
      },
      yAxis: {
        type: 'category',
        data: DAY_LABELS,
        ...ax,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { ...ax.axisLabel, fontSize: 9 },
      },
      visualMap: {
        show: true,
        min: 0,
        max: 50,
        calculable: false,
        orient: 'horizontal',
        left: 'center',
        bottom: 2,
        itemWidth: 8,
        itemHeight: 110,
        text: ['50', '0'],
        textStyle: { color: t.muted, fontSize: 8.5, fontFamily: chartFont },
        inRange: { color: ['rgba(62,210,193,0.05)', hexA(TEAL, 0.5), hexA(AMBER, 0.8), '#e5545a'] },
        itemStyle: { borderRadius: 4 },
      },
      series: [
        {
          type: 'heatmap',
          data,
          itemStyle: { borderRadius: 3, borderWidth: 3, borderColor: bg },
          emphasis: {
            itemStyle: {
              borderColor: theme === 'dark' ? 'rgba(255,255,255,.75)' : 'rgba(10,16,25,.55)',
              borderWidth: 1,
              shadowBlur: 12,
              shadowColor: hexA(TEAL, 0.35),
            },
          },
          animationDuration: 800,
          animationDelay: (idx: number) => (idx % 24) * 10,
        },
      ],
    }
  }, [theme])

  return (
    <div className="page dashboard-page exposure-page">
      <div className="xp-shell">
      <header className="mc-header">
        <div>
          <span className="mono mc-eyebrow">
            SECURITY POSTURE · {DEMO_NOW.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }).toUpperCase()} · {scopeInfo.kind === 'live' ? 'LIVE FEEDS' : scopeInfo.kind === 'uploads' ? 'ALL UPLOADS' : 'UPLOADED DATASET'}
          </span>
          <h1>Command centre</h1>
          <p>Threats correlated to your inventory, ranked by what could actually reach a system you run.</p>
        </div>
        <div className="mc-header-actions">
          {scopeInfo.kind !== 'live' ? (
            <span className="badge upload">{scopeInfo.label} · {inventory.length} {plural(inventory.length, 'asset')}</span>
          ) : uploadDatasets.length > 0 ? (
            <span className="badge upload">{uploadDatasets.length} {plural(uploadDatasets.length, 'upload')} available</span>
          ) : null}
          <button className="btn btn-ghost btn-sm" onClick={() => navigate('/app/recommendations')}>
            <ShieldCheck size={13} /> {openActions} open actions
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => navigate('/app/scoring')}>
            <Zap size={13} /> Scoring model
          </button>
          <button className="btn btn-primary btn-sm" onClick={() => navigate('/app/alerts')}>
            Review alerts <ArrowRight size={13} />
          </button>
        </div>
      </header>

      <section
        className={cx('lcs-strip', loginFailed && 'hot', login.status === 'offline' && 'offline')}
        aria-label="Live identity capture from the Northwind decoy portal"
      >
        <div className="lcs-lead">
          <span className="lcs-signal" aria-hidden="true">
            <i />
          </span>
          <div className="lcs-copy">
            <div className="lcs-title">
              <strong>Live identity capture</strong>
              <span className="lcs-source">
                Northwind decoy portal ·{' '}
                {loginLive
                  ? `auto-fetch 2s${login.lastSync ? ` · synced ${timeAgo(login.lastSync)}` : ''}`
                  : login.status === 'offline'
                    ? 'portal offline · last capture kept'
                    : 'connecting to portal'}
              </span>
            </div>
            <p className="lcs-note">
              {login.analysis.metrics.attempts
                ? `${login.analysis.metrics.attempts} sign-in ${plural(login.analysis.metrics.attempts, 'request')} ingested as the live dataset. ${
                    loginFailed
                      ? `${login.failed} ${plural(login.failed, 'failure')} flagged and counted per request.`
                      : 'No failures recorded yet.'
                  }`
                : 'No sign-in requests yet. Open the decoy portal, fail a login a few times, and the capture becomes a dataset here automatically.'}
            </p>
          </div>
        </div>

        <div className="lcs-metrics">
          <div className={cx('lcs-metric', loginFailed && 'hot')}>
            <b>{login.failed}</b>
            <span>failed</span>
          </div>
          <div className="lcs-metric">
            <b>{login.granted}</b>
            <span>granted</span>
          </div>
          <div className="lcs-metric">
            <b>{login.analysis.metrics.attempts}</b>
            <span>attempts</span>
          </div>
          <div className="lcs-metric">
            <b>{login.accounts}</b>
            <span>accounts</span>
          </div>
          <div className="lcs-metric">
            <b>{login.countries}</b>
            <span>countries</span>
          </div>
          <div className={cx('lcs-risk', login.analysis.level.toLowerCase())}>
            <b>{login.analysis.score}</b>
            <span>{login.analysis.level} · risk score</span>
          </div>
        </div>

        <div className="lcs-actions">
          <button className="btn btn-ghost btn-sm" onClick={() => navigate('/app/anomalies')}>
            <Activity size={12} /> Analyse attempts
          </button>
          <a className="btn btn-primary btn-sm" href={portalUrl} target="_blank" rel="noreferrer">
            Open decoy portal <ExternalLink size={12} />
          </a>
        </div>

        {login.latestFailure && (
          <div className="lcs-latest">
            <AlertTriangle size={11} />
            <span>
              Latest failure · <b>{login.latestFailure.email}</b> from{' '}
              {login.latestFailure.city ? `${login.latestFailure.city}, ` : ''}
              {login.latestFailure.countryName} at{' '}
              {new Date(login.latestFailure.at).toLocaleTimeString('en-US', {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                hour12: false,
              })}
              {login.latestFailure.isTor ? ' · Tor exit' : ''}
            </span>
            <button className="lcs-link" onClick={() => navigate('/app/anomalies')}>
              Open evidence <ArrowRight size={10} />
            </button>
          </div>
        )}
      </section>

      <div className="mc-shell">
        <div className="mc-col-left">
          <section className="mc-card mc-posture-card">
            <McHead
              icon={<ShieldAlert size={17} />}
              tone="orange"
              title="Today's posture"
              sub="Exposure index · live queue"
            />
            <div className="mc-posture-body">
              <MoonGauge
                value={posture}
                max={100}
                label="posture score"
                ariaLabel="Posture score"
                segments={severityShares.map((s, i) => ({ value: s.value, color: gaugeColors[i], label: s.level }))}
              />
              <div className="mc-gauge-legend">
                {severityShares.map((s, i) => (
                  <span className="mc-legend-dot" key={s.level}>
                    <i style={{ background: gaugeColors[i] }} />
                    {s.value} {s.level.toLowerCase()}
                  </span>
                ))}
              </div>
              <div className="mc-deduct">
                {deduction > 0
                  ? `${counts.critical} × 15 + ${counts.high} × 6 = ${deduction} pts deducted`
                  : 'No active deductions this window'}
              </div>
            </div>
            <div className="mc-trio">
              <div>
                <span className="ic">
                  <AlertTriangle size={12} />
                </span>
                <strong>{counts.critical}</strong>
                <span>Critical now</span>
              </div>
              <div>
                <span className="ic">
                  <Activity size={12} />
                </span>
                <strong>{counts.high}</strong>
                <span>High risk</span>
              </div>
              <div>
                <span className="ic">
                  <Globe2 size={12} />
                </span>
                <strong>{exposureActive.length}</strong>
                <span>Internet-facing</span>
              </div>
            </div>
          </section>

          <section className="mc-card mc-pressure-card">
            <McHead
              icon={<BarChart3 size={16} />}
              tone="navy"
              title="Alert pressure"
              sub="Share of the active queue"
            />
            <div className="mc-table" role="table" aria-label="Alert pressure by severity">
              <div className="mc-table-head" role="row">
                <span role="columnheader">Severity</span>
                <span className="num" role="columnheader">
                  Share
                </span>
                <span className="num" role="columnheader">
                  Alerts
                </span>
              </div>
              <div className="mc-table-body" role="rowgroup">
                {severityShares.map((s) => (
                  <div className="mc-row" role="row" key={s.level}>
                    <span role="cell">
                      <span className="mc-sev">
                        <i style={{ background: LEVEL_COLORS[s.level] }} />
                        {s.level.charAt(0) + s.level.slice(1).toLowerCase()}
                      </span>
                    </span>
                    <span className="num pct" role="cell">
                      {s.share.toFixed(0)}%
                    </span>
                    <span className="num" role="cell">
                      {s.value}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <div className="mc-press-facts">
              <div>
                <span>Median EPSS</span>
                <b>{stats[1].value}</b>
              </div>
              <div>
                <span>Suppression rate</span>
                <b>{stats[4].value}</b>
              </div>
            </div>
            <button className="mc-highlight" onClick={() => navigate('/app/alerts')}>
              <span className="mc-highlight-dot" />
              <span className="mc-highlight-label">KEV-linked</span>
              <b>{kevActive.length}</b>
              <span className="dim">of {counts.active} active</span>
              <ArrowRight size={14} />
            </button>
          </section>
        </div>

        <div className="mc-col-main">
          <section className="mc-card mc-hero-card">
            <McHead
              icon={<Activity size={17} />}
              tone="soft"
              title="Threat landscape"
              sub="Ingested CVEs and known-exploited additions"
              action={
                <>
                  <div className="mc-seg" role="group" aria-label="Chart range">
                    {([7, 14, 30] as const).map((d) => (
                      <button
                        key={d}
                        type="button"
                        className={cx(range === d && 'on')}
                        aria-pressed={range === d}
                        onClick={() => setRange(d)}
                      >
                        {d}D
                      </button>
                    ))}
                  </div>
                  <span className="mc-kebab" aria-hidden="true">
                    ⋯
                  </span>
                </>
              }
            />
            <div className="mc-hero-body">
              <div className="mc-hero-left">
                <div className="mc-big">
                  <span className="mc-big-num">
                    <Counter to={counts.active} />
                  </span>
                  <button className="mc-details" onClick={() => navigate('/app/alerts')}>
                    Details
                  </button>
                </div>
                <div className="mc-big-label">
                  Active alerts <span className="dim">· {counts.total} correlated candidates</span>
                </div>
                <div className="mc-break">
                  {severityShares.map((s) => (
                    <div
                      className="mc-break-row"
                      key={s.level}
                      style={{ '--tone': LEVEL_COLORS[s.level] } as CSSProperties}
                    >
                      <div className="top">
                        <span>{s.level.charAt(0) + s.level.slice(1).toLowerCase()}</span>
                        <b>{s.share.toFixed(1)}%</b>
                      </div>
                      <div className="mc-break-track">
                        <i style={{ width: `${Math.max(2, s.share)}%` }} />
                      </div>
                      <div className="sub">{s.value} alerts in the queue</div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="mc-hero-chart">
                <Chart option={threatOption} height={286} />
              </div>
            </div>
            <div className="mc-hero-foot">
              <div>
                <span className="lab">KEV-linked</span>
                <span className="val">
                  {kevActive.length} of {counts.kev} KEV CVEs
                </span>
              </div>
              <div>
                <span className="lab">Suppressed</span>
                <span className="val">{counts.suppressed} by relevance</span>
              </div>
              <div>
                <span className="lab">Inventory coverage</span>
                <span className="val">
                  {coverage}% · {versioned} of {inventory.length} versioned
                </span>
              </div>
            </div>
          </section>

          <div className="mc-lower">
            <section className="mc-card mc-critical-card">
              <McHead
                icon={<ShieldAlert size={16} />}
                tone="soft"
                title="Critical right now"
                sub={`${counts.critical} critical · ${counts.high} high in the live queue`}
                action={
                  <button className="mc-link" onClick={() => navigate('/app/alerts')}>
                    Open queue <ArrowRight size={11} />
                  </button>
                }
              />
              <ul className="crit-list">
                {topCritical.map((a, i) => (
                  <li
                    key={a.id}
                    className={cx('crit-row', a.level.toLowerCase())}
                    style={{ '--i': i } as CSSProperties}
                    onClick={() => navigate(`/app/alerts?alert=${a.id}`)}
                  >
                    <span className="crit-dot" aria-hidden="true" />
                    <div className="crit-body">
                      <div className="crit-title">
                        <strong>{a.cve.id}</strong>
                        <SeverityBadge level={a.level} />
                      </div>
                      <div className="crit-name">{a.cve.title}</div>
                      <div className="crit-meta">
                        {a.asset.name} · {a.asset.department} · {timeAgo(a.createdAt, DEMO_NOW)}
                      </div>
                    </div>
                    <div className="crit-score">
                      {fmtScore(a.score)}
                      <small>score</small>
                    </div>
                  </li>
                ))}
              </ul>
              <div className="crit-foot">
                <span className="mono">XGBoost v{MODEL_CARD.version} second opinion</span>
                <span className="mono">
                  {liveMl.portfolio.elevated} elevated ≥{(ML_BANDS.elevated * 100).toFixed(1)}%
                </span>
              </div>
            </section>

            <section className="mc-card mc-risk-card">
              <McHead
                icon={<CircleDot size={16} />}
                tone="soft"
                title="Risk composition"
                sub="Active alerts by severity"
                action={<span className="mc-chip">n={counts.active}</span>}
              />
              <div className="mc-risk-body">
                <Chart option={donutOption} height={214} />
                <ul className="mc-risk-legend">
                  {severityShares.map((s) => (
                    <li key={s.level}>
                      <span className="mc-sev">
                        <i style={{ background: gaugeColors[SEVERITIES.indexOf(s.level)] }} />
                        {s.level.charAt(0) + s.level.slice(1).toLowerCase()}
                      </span>
                      <span className="mc-risk-share">{s.share.toFixed(0)}%</span>
                      <b>{s.value}</b>
                    </li>
                  ))}
                </ul>
              </div>
            </section>
          </div>
        </div>
      </div>

      <AiBriefing />

      <div className="mc-stack">
        <Panel
          className="col-5"
          title="Detection funnel"
          sub={`${counts.cves} ingested → ${counts.active} active after the gate → ${counts.critical} critical`}
          action={
            <button className="panel-link" onClick={() => navigate('/app/alerts')}>
              Open alert center <ArrowRight size={11} />
            </button>
          }
          noPad
          spotlight
        >
          <Chart option={funnelOption} height={286} />
          <div className="chart-legend">
            <span className="legend-item">
              <i style={{ background: LEVEL_COLORS.CRITICAL }} /> {counts.critical} patch this window
            </span>
            <span className="legend-item">
              <i style={{ background: AMBER }} /> {counts.suppressed} suppressed by relevance
            </span>
            <span className="legend-item dim">hover a band for the stage note</span>
          </div>
        </Panel>

        <Panel
          className="col-7 treemap-panel"
          title="Asset exposure treemap"
          sub="Area weighted by score · colour by highest risk level"
          action={
            <button className="panel-link" onClick={() => navigate('/app/assets')}>
              All assets <ArrowRight size={11} />
            </button>
          }
          noPad
          spotlight
        >
          <div className="treemap-wrap">
            <Chart option={treemapOption} height={288} />
          </div>
        </Panel>

        <Panel
          className="col-12 heatmap-panel"
          title="Authentication activity"
          sub={`Events per hour · 7-day window · peak ${DAY_LABELS[peakActivity.day]} ${String(peakActivity.hour).padStart(2, '0')}:00 (${peakActivity.value})`}
          action={<span className="badge simulated">Simulated</span>}
          noPad
          spotlight
        >
          <Chart option={heatmapOption} height={306} />
        </Panel>

        <Panel
          className="col-12"
          title="Attack chain"
          sub="How an intrusion would move · technique counts from the trimmed ATT&CK subset"
          action={<span className="mono">MITRE · illustrative</span>}
          noPad
          spotlight
        >
          <AttackChain />
        </Panel>

        <Panel
          className="col-12"
          title="Priority queue"
          sub={`${topAlerts.length} of ${activeAlerts.length} active alerts · XGBoost flags ${liveMl.portfolio.elevated} at ≥${(ML_BANDS.elevated * 100).toFixed(1)}% · sorted by six-factor score`}
          action={
            <button className="panel-link" onClick={() => navigate('/app/alerts')}>
              Full queue <ArrowRight size={11} />
            </button>
          }
          noPad
          spotlight
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
          Demo window {DEMO_NOW.toISOString().slice(0, 16).replace('T', ' ')}Z · {fmtInt(counts.cves)} CVEs · {inventory.length} {plural(inventory.length, 'asset')} · {counts.total} correlation candidates
        </span>
        <span className="mono">Labels: NVD / CISA KEV / FIRST EPSS = real · SIMULATED = seeded · USER UPLOAD = customer data</span>
      </div>
      </div>
    </div>
  )
}

function MlCell({ alert }: { alert: Alert }) {
  const { probability, band } = predict(alert)
  return (
    <div className={`ml-cell ${band.toLowerCase()}${alert.suppressed ? ' gated' : ''}`}>
      <span className="mono ml-cell-value">{(probability * 100).toFixed(0)}%</span>
      <span className="ml-cell-track" aria-hidden="true">
        <i style={{ width: `${Math.max(3, probability * 100)}%` }} />
      </span>
    </div>
  )
}
