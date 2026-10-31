import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useInView, useReducedMotion } from 'framer-motion'
import { Chart, axisStyle, chartFont, chartTokens } from '../../components/Chart'
import { Panel, PageHeader } from '../../components/Panel'
import AiBriefing from '../../components/AiBriefing'
import { RadialGauge } from '../../components/RadialGauge'
import { SeverityBadge, SourceBadge } from '../../components/Badges'
import { Sparkline } from '../../components/Sparkline'
import { StatsPanel } from '../../components/StatsPanel'
import { Counter } from '../../components/Counter'
import { AttackChain } from '../../components/AttackChain'
import { AlertTriangle, ArrowRight, Bug, ExternalLink, Globe2, ShieldAlert, ShieldCheck, Zap } from '../../components/Icons'
import {
  activityHeatmap,
  alertDaily,
  assets as seedAssets,
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
import { allUploadedAssets, useUploads } from '../../lib/uploads'
import { cx, fmtInt, fmtScore, timeAgo } from '../../lib/format'
import { median, spearman, stdev, mean } from '../../lib/stats'
import { predict, ML_BANDS, MODEL_CARD } from '../../lib/ml'
import { AMBER, LEVEL_COLORS, SUPPRESSED, TEAL, hexA, levelColor } from '../../lib/colors'
import type { Alert, RiskLevel } from '../../lib/types'

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const SEVERITIES: RiskLevel[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']

export default function Dashboard() {
  const navigate = useNavigate()
  const theme = useTheme((s) => s.theme)
  const query = useFilters((s) => s.query)
  const severity = useFilters((s) => s.severity)

  const alerts = useLiveAlerts()
  const activeAlerts = useLiveActiveAlerts()
  const suppressedAlerts = useLiveSuppressedAlerts()
  const counts = useLiveCounts()
  const posture = useLivePosture()
  const liveMl = useLiveMl()

  const uploadDatasets = useUploads((s) => s.datasets)
  const uploadedAssets = useMemo(() => allUploadedAssets(uploadDatasets), [uploadDatasets])
  const inventory = useMemo(() => [...uploadedAssets, ...seedAssets], [uploadedAssets])
  const versioned = inventory.filter((a) => a.software.every((s) => s.version && s.version !== 'unknown')).length
  const coverage = Math.round((versioned / Math.max(1, inventory.length)) * 100)

  const kevActive = activeAlerts.filter((a) => a.cve.kev)
  const exposureActive = activeAlerts.filter((a) => a.asset.internetFacing)
  const criticalAssets = activeAlerts.filter((a) => a.asset.criticality === 'HIGH')

  const levelCounts = SEVERITIES.map((level) => ({
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
        value: spearman(activeAlerts.map((a) => predict(a).probability), scores).toFixed(2),
        formula: 'Spearman ρ · XGBoost prior vs six-factor score',
        n: scores.length,
        note: `XGBoost v${MODEL_CARD.version} · test AUC ${MODEL_CARD.test.auc.toFixed(3)} on live NVD/EPSS feeds.`,
      },
    ]
  }, [activeAlerts, suppressedAlerts, alerts])

  const threatOption = useMemo(() => {
    const ax = axisStyle(theme, { split: true })
    const t = chartTokens(theme)
    const values = threatDaily.map((d) => d.newCves)
    const avg = values.reduce((a, b) => a + b, 0) / Math.max(1, values.length)
    return {
      grid: { left: 42, right: 20, top: 42, bottom: 30 },
      xAxis: {
        type: 'category',
        data: threatDaily.map((d) => d.label),
        ...ax,
        axisLabel: { ...ax.axisLabel, interval: 4, fontSize: 9.5 },
        axisPointer: { label: { show: false } },
      },
      yAxis: { type: 'value', ...ax, splitNumber: 4, axisLabel: { ...ax.axisLabel, fontSize: 9.5 } },
      tooltip: {
        trigger: 'axis',
        axisPointer: {
          type: 'cross',
          lineStyle: { color: t.muted, width: 1, type: 'dashed' },
          crossStyle: { color: t.muted, width: 1, type: 'dashed' },
          label: {
            backgroundColor: t.tooltipBg,
            borderColor: t.tooltipBorder,
            borderWidth: 1,
            color: t.tooltipText,
            fontSize: 9,
            fontFamily: chartFont,
            padding: [4, 6],
          },
        },
        formatter: (params: any[]) => {
          const i = params[0]?.dataIndex ?? 0
          const d = threatDaily[i]
          return `<div style="font-weight:600;margin-bottom:5px">${d.label}</div>
            <div style="display:flex;gap:16px;justify-content:space-between"><span><i style="display:inline-block;width:7px;height:7px;border-radius:2px;background:${TEAL};margin-right:6px"></i>New CVEs</span><b>${d.newCves}</b></div>
            <div style="display:flex;gap:16px;justify-content:space-between"><span><i style="display:inline-block;width:7px;height:7px;border-radius:2px;background:${AMBER};margin-right:6px"></i>KEV additions</span><b>${d.kev}</b></div>`
        },
      },
      series: [
        {
          name: 'KEV additions',
          type: 'bar',
          data: threatDaily.map((d) => d.kev),
          barWidth: '34%',
          z: 1,
          itemStyle: {
            borderRadius: [3, 3, 0, 0],
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: hexA(AMBER, 0.92) },
                { offset: 1, color: hexA(AMBER, 0.3) },
              ],
            },
          },
          emphasis: { itemStyle: { color: AMBER, shadowBlur: 14, shadowColor: hexA(AMBER, 0.5) } },
          animationDelay: (idx: number) => idx * 22,
        },
        {
          name: 'New CVEs',
          type: 'line',
          smooth: 0.45,
          symbol: 'circle',
          showSymbol: false,
          symbolSize: 6,
          data: values,
          z: 3,
          lineStyle: { width: 2, color: TEAL, shadowBlur: 16, shadowColor: hexA(TEAL, 0.45) },
          itemStyle: { color: TEAL, borderColor: theme === 'dark' ? '#0a1019' : '#fbf9f4', borderWidth: 2 },
          areaStyle: {
            color: {
              type: 'linear',
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: hexA(TEAL, 0.32) },
                { offset: 0.55, color: hexA(TEAL, 0.1) },
                { offset: 1, color: hexA(TEAL, 0) },
              ],
            },
          },
          emphasis: { focus: 'series', lineStyle: { width: 2.4 } },
          markLine: {
            silent: true,
            symbol: 'none',
            lineStyle: { color: hexA(t.muted, 0.65), type: 'dashed', width: 1 },
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
            itemStyle: { color: TEAL, borderColor: hexA(TEAL, 0.28), borderWidth: 6 },
            label: { show: false },
            data: [{ type: 'max' }],
          },
        },
      ],
    }
  }, [theme])

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
    const t = chartTokens(theme)
    const bg = theme === 'dark' ? '#0a1019' : '#fbf9f4'
    return {
      tooltip: { trigger: 'item', formatter: '{b}<br/><b>{c}</b> active · {d}%' },
      legend: {
        bottom: 2,
        left: 'center',
        itemWidth: 8,
        itemHeight: 8,
        itemGap: 14,
        icon: 'roundRect',
        textStyle: { color: t.muted, fontSize: 9, fontFamily: chartFont },
      },
      title: {
        text: String(counts.active),
        subtext: 'active alerts',
        left: 'center',
        top: '31%',
        textStyle: { fontSize: 34, fontWeight: 500, color: t.text },
        subtextStyle: {
          fontSize: 8.5,
          color: t.muted,
          fontFamily: chartFont,
        },
      },
      series: [
        {
          type: 'pie',
          radius: ['54%', '76%'],
          center: ['50%', '43%'],
          startAngle: 90,
          minAngle: 8,
          padAngle: 3,
          label: { show: false },
          labelLine: { show: false },
          itemStyle: {
            borderColor: bg,
            borderWidth: 2,
            borderRadius: 6,
            shadowBlur: 10,
            shadowColor: 'rgba(0,0,0,.35)',
          },
          emphasis: {
            scaleSize: 7,
            itemStyle: { shadowBlur: 24, shadowColor: 'rgba(0,0,0,.4)' },
          },
          animationType: 'scale',
          animationEasing: 'cubicOut',
          animationDuration: 1000,
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
  }, [theme])

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

  const kpiSparks = useMemo(
    () => ({
      posture: alertDaily.map((d) => d.critical * 15 + d.high * 6 + 8),
      active: alertDaily.map((d) => d.critical + d.high + d.medium + d.low + 1),
      critical: alertDaily.map((d) => d.critical),
      kev: threatDaily.map((d) => d.kev),
      exposure: [3, 4, 4, 5, 5, 6, 7, exposureActive.length],
      coverage: [88, 92, 92, 96, 96, 100, 100, 100],
    }),
    [exposureActive.length],
  )

  return (
    <div className="page dashboard-page">
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
        <KpiCard
          tone="critical"
          icon={<ShieldAlert size={11} />}
          label="Posture score"
          value={<Counter to={posture} />}
          small="/ 100 · higher is better"
          delta="−8 vs last week"
          deltaTone="up"
          spark={kpiSparks.posture}
          sparkColor="#e5545a"
          delay={0}
          onClick={() => navigate('/app/alerts')}
        />
        <KpiCard
          tone="high"
          icon={<Zap size={11} />}
          label="Active alerts"
          value={<Counter to={counts.active} />}
          small={`of ${counts.total} candidates`}
          delta={`${counts.suppressed} suppressed by relevance`}
          spark={kpiSparks.active}
          sparkColor="#e08a2f"
          delay={70}
          onClick={() => navigate('/app/alerts')}
        />
        <KpiCard
          tone="critical"
          icon={<AlertTriangle size={11} />}
          label="Critical now"
          value={<Counter to={counts.critical} />}
          small="needs patch this window"
          delta="KEV floor applied to 2"
          spark={kpiSparks.critical}
          sparkColor="#e5545a"
          delay={140}
          onClick={() => navigate('/app/alerts')}
        />
        <KpiCard
          tone="amber"
          icon={<Bug size={11} />}
          label="KEV-linked alerts"
          value={<Counter to={kevActive.length} />}
          small="known exploited"
          delta={`of ${counts.kev} KEV CVEs ingested`}
          spark={kpiSparks.kev}
          sparkColor="#e3a455"
          delay={210}
          onClick={() => navigate('/app/cves')}
        />
        <KpiCard
          tone="teal"
          icon={<Globe2 size={11} />}
          label="Internet-facing"
          value={<Counter to={exposureActive.length} />}
          small="exposed assets alerting"
          delta="+5 exposure points each"
          spark={kpiSparks.exposure}
          sparkColor="#3ed2c1"
          delay={280}
          onClick={() => navigate('/app/map')}
        />
        <KpiCard
          tone="low"
          icon={<ShieldCheck size={11} />}
          label="Inventory coverage"
          value={<Counter to={coverage} />}
          small={`% · ${inventory.length} assets`}
          delta={
            <>
              version-aware on {versioned} of {inventory.length}
              {uploadedAssets.length ? ` · ${uploadedAssets.length} uploaded` : ''}
            </>
          }
          deltaTone="down"
          spark={kpiSparks.coverage}
          sparkColor="#3fae74"
          delay={350}
          onClick={() => navigate('/app/assets')}
        />
      </div>

      <AiBriefing />

      <div className="dash-grid">
        <Panel
          className="col-6 crit-panel"
          title="Critical right now"
          sub={`${counts.critical} critical · ${counts.high} high after the relevance gate`}
          action={
            <button className="panel-link" onClick={() => navigate('/app/alerts')}>
              Open queue <ArrowRight size={11} />
            </button>
          }
          noPad
          spotlight
        >
          <div
            className="sev-meter"
            role="img"
            aria-label={`Severity mix: ${levelCounts.map((l) => `${l.level} ${l.value}`).join(', ')}`}
          >
            {levelCounts.map((l) => (
              <span
                key={l.level}
                style={{ '--w': `${(l.value / Math.max(1, counts.active)) * 100}%`, background: LEVEL_COLORS[l.level] } as CSSProperties}
              />
            ))}
          </div>
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
        </Panel>

        <Panel
          className="col-6 posture-panel"
          title="Posture"
          sub="Exposure index · 4 critical alerts × 15 + 4 high × 6"
          action={<span className="mono">SIMULATED</span>}
          noPad
          spotlight
        >
          <div className="posture-body">
            <PostureGauge posture={posture} />
            <div className="posture-factors">
              <FactorLine label="KEV-active alerts" value={kevActive.length} total={counts.active} tone="#e5545a" />
              <FactorLine label="Internet-facing" value={exposureActive.length} total={counts.active} tone="#e3a455" />
              <FactorLine label="High-criticality assets" value={criticalAssets.length} total={counts.active} tone="#e08a2f" />
              <FactorLine label="Suppressed low-value" value={suppressedAlerts.length} total={alerts.length} tone="#3fae74" />
            </div>
          </div>
        </Panel>

        <Panel
          className="col-12"
          title="Threat landscape · 30 days"
          sub="Ingested CVEs and known-exploited additions · demo series"
          action={<span className="badge real">NVD · KEV</span>}
          noPad
          spotlight
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
          className="col-6"
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
          className="col-6"
          title="Risk composition"
          sub={`Active alerts only · ${counts.suppressed} suppressed not counted`}
          action={<span className="mono">n={counts.active}</span>}
          noPad
          spotlight
        >
          <Chart option={donutOption} height={286} />
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
          className="col-5 heatmap-panel"
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
          Demo window {DEMO_NOW.toISOString().slice(0, 16).replace('T', ' ')}Z · {fmtInt(18)} CVEs · {inventory.length} assets · 15 correlation candidates
        </span>
        <span className="mono">Labels: NVD / CISA KEV / FIRST EPSS = real · SIMULATED = seeded · USER UPLOAD = customer data</span>
      </div>
    </div>
  )
}

function KpiCard({
  tone,
  icon,
  label,
  value,
  small,
  delta,
  deltaTone,
  spark,
  sparkColor,
  delay,
  onClick,
}: {
  tone?: 'critical' | 'high' | 'teal' | 'amber' | 'low'
  icon?: ReactNode
  label: string
  value: ReactNode
  small?: ReactNode
  delta: ReactNode
  deltaTone?: 'up' | 'down'
  spark: number[]
  sparkColor: string
  delay?: number
  onClick: () => void
}) {
  return (
    <div
      className={cx('kpi', 'interactive', tone && `${tone}-tone`)}
      role="button"
      tabIndex={0}
      onClick={onClick}
      onPointerMove={(e) => {
        const rect = e.currentTarget.getBoundingClientRect()
        e.currentTarget.style.setProperty('--mx', `${e.clientX - rect.left}px`)
        e.currentTarget.style.setProperty('--my', `${e.clientY - rect.top}px`)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick()
        }
      }}
    >
      <span className="kpi-accent" aria-hidden="true" />
      <div className="kpi-label">
        {icon} {label}
      </div>
      <div className="kpi-value">
        {value}
        {small && <small>{small}</small>}
      </div>
      <div className={cx('kpi-delta', deltaTone)}>{delta}</div>
      <div className="kpi-spark">
        <Sparkline values={spark} color={sparkColor} delay={delay ?? 0} fluid />
      </div>
    </div>
  )
}

function PostureGauge({ posture }: { posture: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const inView = useInView(ref, { once: true, margin: '-40px' })
  const reduce = useReducedMotion()
  const [value, setValue] = useState(reduce ? posture : 0)

  useEffect(() => {
    if (!inView) return
    if (reduce) {
      setValue(posture)
      return
    }
    let raf = 0
    const t0 = performance.now()
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / 1500)
      setValue(posture * (1 - Math.pow(1 - p, 3)))
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [inView, posture, reduce])

  return (
    <div ref={ref}>
      <RadialGauge value={value} size={196} stroke={7} color="#e5545a" ticks={52}>
        <div className="posture-center">
          <div className="num">
            {Math.round(value)}
            <small>/100</small>
          </div>
          <div className="label">posture score</div>
          <div className="trend down">▼ 8 pts this week</div>
        </div>
      </RadialGauge>
    </div>
  )
}

function FactorLine({ label, value, total, tone }: { label: string; value: number; total: number; tone: string }) {
  const pct = Math.min(100, (value / Math.max(1, total)) * 100)
  return (
    <div className="factor-line" style={{ '--tone': tone } as CSSProperties}>
      <span>{label}</span>
      <strong>
        {value}
        <span className="dim"> / {total}</span>
      </strong>
      <span className="factor-meter" aria-hidden="true">
        <i style={{ '--w': `${pct}%` } as CSSProperties} />
      </span>
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
