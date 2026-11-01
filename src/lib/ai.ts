import {
  anomalyWindows,
  attackProfiles,
  DEMO_NOW,
  intelItems,
  mitreTactics,
  techniques,
  trafficSeries,
  uploadedDatasets,
} from '../data/seed'
import { componentByPath } from '../app/catalog'
import { FORMULA_VERSION, WEIGHTS, postureFromCounts } from './scoring'
import { predict, ML_BANDS, MODEL_CARD } from './ml'
import {
  currentLiveAlerts,
  currentLiveCounts,
  currentLiveCves,
  currentLiveMl,
  currentLivePosture,
  currentLiveSourceHealth,
} from './liveData'
import { useUploads } from './uploads'
import { normalizeScopeId, scopeInfo, scopedInventory, useDataScope } from './dataScope'
import { LOGIN_LEVELS, LOGIN_POLL_MS } from './loginIntel'
import { currentLoginCapture } from './loginFeed'
import { plural } from './format'
import type { Role } from './store'
import type { Alert, Asset } from './types'

export interface AnalystContext {
  page: { id: number; name: string; group: string; route: string }
  viewer: {
    name: string
    role: Role
    access: string
    restrictedModules: string[]
  }
  asOf: string
  workspace: {
    scope: {
      id: string
      kind: 'live' | 'uploads' | 'dataset'
      label: string
      detail: string
    }
    datasetCount: number
    datasets: { id: string; name: string; assets: number }[]
    note: string
  }
  organisation: {
    postureScore: number
    postureDefinition: string
    activeAlerts: number
    critical: number
    high: number
    medium: number
    low: number
    suppressed: number
    totalCandidates: number
    kevLinked: number
    internetFacingAlerting: number
    versionUnknown: number
    inventoryCoverage: string
    assets: number
    departments: string[]
  }
  scoring: {
    formulaVersion: string
    weights: typeof WEIGHTS
    levels: string
    thresholds: { critical: number; high: number; medium: number }
  }
  machineLearning: {
    model: string
    version: string
    objective: string
    target: string
    trainedAt: string
    rows: number
    features: number
    rounds: number
    cvAuc: number
    testAuc: number
    testLogloss: number
    brier: number
    topFeatures: { feature: string; share: number }[]
    portfolio: {
      coverage: number
      meanProbability: number
      maxProbability: number
      elevated: number
      watch: number
      low: number
    }
    policy: string
  }
  topAlerts: ReturnType<typeof slimAlert>[]
  suppressed: ReturnType<typeof slimAlert>[]
  patchPlan: {
    rank: number
    asset: string
    department: string
    alertCount: number
    cves: string[]
    scoreSum: number
    currentPosture: number
    projectedPosture: number
    postureGain: number
  }[]
  sources: { source: string; status: string; kind: string; lastSuccess: string; note: string }[]
  anomalies: {
    flagged: { window: string; reason: string; failedLogins: number; distinctIps: number; rps: number; score: number }[]
    baselineNote: string
  }
  liveLogin: {
    status: string
    source: string
    lastSync: string | null
    pollSeconds: number
    dataset: {
      id: string
      name: string
      type: string
      rows: number
      failed: number
      granted: number
      autoFetch: boolean
      files: { json: string; csv: string } | null
    } | null
    windows: number
    flaggedWindows: number
    risk: {
      score: number
      rawScore: number
      level: string
      verdict: string
      delta: number
      windowSeconds: number
      firstAt: string | null
      lastAt: string | null
    }
    metrics: {
      attempts: number
      failures: number
      successes: number
      failureRate: number
      accounts: number
      targetedAccounts: number
      ips: number
      countries: number
      recentFailures: number
      peakPerMinute: number
      torEvents: number
      scriptEvents: number
      simulatedEvents: number
      offHours: number
    }
    contributors: { id: string; label: string; value: number; max: number; note: string }[]
    findings: {
      severity: string
      title: string
      detail: string
      evidence: string[]
      technique: { id: string; name: string }
      action: string
    }[]
    techniques: { id: string; name: string }[]
    accounts: {
      email: string
      attempts: number
      failures: number
      successes: number
      ips: number
      countries: string[]
      takeover: boolean
    }[]
    sources: {
      ip: string
      attempts: number
      failures: number
      successes: number
      accounts: string[]
      countries: string[]
      tor: boolean
    }[]
    takeover: {
      email: string
      failuresBefore: number
      successAt: string
      ip: string
      country: string
      city: string
      isTor: boolean
    } | null
    impossibleTravel: {
      email: string
      from: string
      to: string
      minutes: number
      distanceKm: number
      speedKmh: number
    } | null
    narrative: string
    recommendations: string[]
    recentEvents: {
      id: string
      at: string
      email: string
      success: boolean
      sourceIp: string
      country: string
      city?: string
      reason?: string
      isTor: boolean
      simulated: boolean
    }[]
    note: string
  }
  traffic: {
    latest: { time: string; rps: number; failed: number; anomaly: boolean }[]
    note: string
  }
  intel: { id: string; source: string; title: string; category: string; simulated: boolean }[]
  inventory: {
    byType: Record<string, number>
    byCriticality: Record<string, number>
    internetFacing: number
    unverifiedSoftware: string[]
  }
  userUploads: {
    datasetCount: number
    assetsTotal: number
    datasets: {
      name: string
      type: string
      status: string
      rows: number
      accepted: number
      rejected: number
      uploadedAt: string
    }[]
    assets: {
      name: string
      type: string
      department: string
      criticality: string
      internetFacing: boolean
      software: string[]
    }[]
    logs: {
      dataset: string
      total: number
      failedLogins: number
      distinctIps: number
      destinations: string[]
      countries: string[]
      firstTimestamp: string | null
      lastTimestamp: string | null
    }[]
    note: string
  }
  pageData: Record<string, unknown>
  policy: string
}

const hours = (iso: string) => Math.max(0, Math.round((DEMO_NOW.getTime() - new Date(iso).getTime()) / 3_600_000))

function slimAlert(a: Alert) {
  const ml = predict(a)
  return {
    id: a.id,
    score: a.score,
    level: a.level,
    mlProbability: Math.round(ml.probability * 1000) / 1000,
    mlBand: ml.band,
    mlNote: a.suppressed
      ? 'Version relevance gate suppresses this alert; the model prior is shown for audit only.'
      : 'XGBoost second opinion; the deterministic score remains authoritative.',
    cve: a.cve.id,
    title: a.cve.title,
    cvss: a.cve.cvss,
    epss: a.cve.epss,
    kev: a.cve.kev,
    kevDue: a.cve.kevDue ?? null,
    asset: a.asset.name,
    assetId: a.asset.id,
    assetType: a.asset.type,
    department: a.asset.department,
    criticality: a.asset.criticality,
    internetFacing: a.asset.internetFacing,
    product: a.cve.product,
    installedVersion: a.version,
    fixVersion: a.cve.fixVersion,
    relevance: a.relevance,
    confidence: a.confidence,
    ageHours: hours(a.createdAt),
    action: a.action,
    reason: a.reasoning,
    suppressedReason: a.suppressionReason ?? null,
    wouldHaveScored: a.wouldHaveScored ?? null,
    breakdown: a.breakdown,
  }
}

function slimAsset(a: Asset) {
  return {
    id: a.id,
    name: a.name,
    type: a.type,
    department: a.department,
    criticality: a.criticality,
    internetFacing: a.internetFacing,
    businessFunction: a.businessFunction,
    sensitivity: a.sensitivity,
    software: a.software.map((s) => `${s.vendor} ${s.product} ${s.version}`),
  }
}

const truncate = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

function buildPatchPlan(activeAlerts: Alert[], currentPosture: number) {
  const groups = new Map<string, Alert[]>()
  for (const alert of activeAlerts) {
    const list = groups.get(alert.asset.id) ?? []
    list.push(alert)
    groups.set(alert.asset.id, list)
  }
  return [...groups.entries()]
    .map(([assetId, list]) => {
      const remaining = activeAlerts.filter((a) => a.asset.id !== assetId)
      const critical = remaining.filter((a) => a.level === 'CRITICAL').length
      const high = remaining.filter((a) => a.level === 'HIGH').length
      const projected = postureFromCounts({ critical, high })
      const gain = projected - currentPosture
      return {
        asset: list[0].asset.name,
        department: list[0].asset.department,
        alertCount: list.length,
        cves: list.map((a) => a.cve.id),
        scoreSum: Math.round(list.reduce((sum, a) => sum + a.score, 0) * 10) / 10,
        currentPosture,
        projectedPosture: projected,
        postureGain: gain,
      }
    })
    .sort((a, b) => b.scoreSum - a.scoreSum)
    .slice(0, 4)
    .map((row, i) => ({ rank: i + 1, ...row }))
}

export function buildAnalystContext(
  pathname: string,
  viewer: { role?: Role; name?: string } = {},
): AnalystContext {
  const role: Role = viewer.role ?? 'ANALYST'
  const component = componentByPath(pathname)
  const uploadDatasets = useUploads.getState().datasets
  const scopeId = normalizeScopeId(useDataScope.getState().scopeId, uploadDatasets)
  const scope = scopeInfo(scopeId, uploadDatasets)
  const mergedAssets = scopedInventory(scopeId, uploadDatasets)
  const uploadedAssets = mergedAssets.filter((asset) => asset.source === 'USER UPLOAD')
  const liveAlerts = currentLiveAlerts()
  const liveActive = liveAlerts.filter((alert) => !alert.suppressed)
  const liveSuppressed = liveAlerts.filter((alert) => alert.suppressed)
  const liveCves = currentLiveCves()
  const liveCounts = currentLiveCounts()
  const liveMl = currentLiveMl(liveAlerts)
  const livePosture = currentLivePosture()
  const sorted = [...liveActive].sort((a, b) => b.score - a.score)
  const top = sorted.slice(0, 8)
  const patchPlan = buildPatchPlan(liveActive, livePosture)
  const liveLogin = currentLoginCapture()
  const loginAnalysis = liveLogin.analysis
  const liveWindows = liveLogin.windows
  const flagged = liveWindows.length
    ? liveWindows.filter((w) => w.failedLogins > 0)
    : anomalyWindows.filter((w) => w.anomaly)
  const loginRecent = [...liveLogin.events]
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    .slice(0, 12)
  const contextDatasets = liveLogin.dataset ? [liveLogin.dataset, ...uploadDatasets] : uploadDatasets

  const byType: Record<string, number> = {}
  const byCriticality: Record<string, number> = {}
  for (const a of mergedAssets) {
    byType[a.type] = (byType[a.type] ?? 0) + 1
    byCriticality[a.criticality] = (byCriticality[a.criticality] ?? 0) + 1
  }
  const verifiedAssets = mergedAssets.filter((a) => a.software.every((s) => s.version && s.version !== 'unknown')).length

  const pageData: Record<string, unknown> = {}
  if (component.id === 2) pageData.alerts = liveAlerts.map(slimAlert)
  if (component.id === 3) {
    pageData.weights = WEIGHTS
    pageData.formulaVersion = FORMULA_VERSION
    pageData.thresholds = { critical: 85, high: 65, medium: 40, low: 0 }
    pageData.workedExample = slimAlert(sorted[0])
    pageData.suppressionExample = liveSuppressed[0] ? slimAlert(liveSuppressed[0]) : null
    pageData.mlModelCard = {
      version: MODEL_CARD.version,
      target: MODEL_CARD.target,
      rows: MODEL_CARD.dataset.rows,
      rounds: MODEL_CARD.rounds,
      cvAuc: MODEL_CARD.cv.auc,
      testAuc: MODEL_CARD.test.auc,
      testLogloss: MODEL_CARD.test.logloss,
      brier: MODEL_CARD.test.brier,
      topFeatures: MODEL_CARD.featureImportance.slice(0, 6),
    }
    pageData.mlTopAlerts = liveMl.portfolio.top.map((row) => ({
      alert: row.alert.cve.id,
      asset: row.alert.asset.name,
      probability: Math.round(row.prediction.probability * 1000) / 1000,
      band: row.prediction.band,
    }))
  }
  if (component.id === 4) {
    pageData.edges = liveAlerts.map((a) => ({
      cve: a.cve.id,
      asset: a.asset.name,
      relevance: a.relevance,
      score: a.suppressed ? null : a.score,
      suppressed: a.suppressed,
    }))
    pageData.note = 'Inner ring is assets, outer ring is CVEs; only version-gated edges carry a score.'
  }
  if (component.id === 5) {
    pageData.profiles = attackProfiles.map((p) => ({
      name: p.name,
      category: p.category,
      defaultSeverity: p.defaultSeverity,
      techniques: p.techniques,
      mitigations: p.mitigations.map((m) => `${m.control} (${m.team})`),
      indicators: p.indicators,
    }))
  }
  if (component.id === 6) pageData.assets = mergedAssets.slice(0, 80).map(slimAsset)
  if (component.id === 7) {
    pageData.cves = liveCves.map((c) => ({
      id: c.id,
      title: c.title,
      cvss: c.cvss,
      severity: c.severity,
      epss: c.epss,
      kev: c.kev,
      vendor: c.vendor,
      product: c.product,
      fixVersion: c.fixVersion,
    }))
  }
  if (component.id === 8 || component.id === 14) {
    pageData.intel = intelItems.map((i) => ({
      id: i.id,
      source: i.source,
      title: i.title,
      category: i.category,
      simulated: Boolean(i.simulated),
    }))
  }
  if (component.id === 9) {
    const scopedWindows = liveWindows.length ? liveWindows : anomalyWindows
    pageData.mode = liveWindows.length ? 'live Northwind portal capture' : 'seeded demo windows'
    pageData.flaggedWindows = flagged.map((w) => ({
      window: w.label,
      account: w.account ?? null,
      sourceIp: w.sourceIp ?? null,
      country: w.country ?? null,
      outcome: w.failedLogins > 0 ? 'FAILED' : 'GRANTED',
      reason: w.reason ?? '',
      failedLogins: w.failedLogins,
      distinctIps: w.distinctIps,
      rps: w.rps,
      riskScore: w.riskScore ?? null,
      isolationScore: w.anomalyScore,
    }))
    pageData.baseline = {
      windows: scopedWindows.length,
      flagged: flagged.length,
      meanRps: Math.round((scopedWindows.reduce((s, w) => s + w.rps, 0) / Math.max(1, scopedWindows.length)) * 10) / 10,
      meanFailedLogins:
        Math.round((scopedWindows.reduce((s, w) => s + w.failedLogins, 0) / Math.max(1, scopedWindows.length)) * 10) / 10,
    }
    pageData.note = liveWindows.length
      ? 'The anomaly board is driven by the live portal dataset: one window per sign-in request. Every failed request is flagged, even when the cumulative risk score is still low.'
      : 'The anomaly board is showing seeded demo windows because the portal has no captured sign-ins yet.'
  }
  if (component.id === 10) {
    pageData.note = 'The simulator re-runs the deterministic score when an asset is patched, made internet-facing or reclassified.'
    pageData.patchPlan = patchPlan
  }
  if (component.id === 11) {
    pageData.tactics = mitreTactics
    pageData.observedTechniques = [...techniques].sort((a, b) => b.observed - a.observed).slice(0, 12)
  }
  if (component.id === 13) {
    pageData.provenance = sorted.slice(0, 3).map((a) => ({
      alert: a.id,
      cve: a.cve.id,
      published: a.cve.published,
      modified: a.cve.modified,
      references: a.cve.refs.map((r) => ({ source: r.source, url: r.url })),
      asset: a.asset.name,
      version: a.version,
      score: a.score,
      breakdown: a.breakdown,
    }))
  }
  if (component.id === 15) {
    pageData.traffic = trafficSeries.slice(-16)
    pageData.flaggedWindows = flagged
  }
  if (component.id === 16) {
    pageData.datasets = [
      ...contextDatasets.map((d) => ({
        name: d.name,
        type: d.type,
        status: d.status,
        rows: d.rows,
        accepted: d.accepted,
        rejected: d.rejected,
        uploadedAt: d.uploadedAt,
        source: d.source ?? 'USER UPLOAD',
        live: Boolean(d.live),
        failedLogins: d.logs?.failedLogins ?? null,
        risk: d.risk ?? null,
      })),
      ...uploadedDatasets.map((d) => ({
        name: d.name,
        type: d.type,
        status: d.status,
        rows: d.rows,
        accepted: d.accepted,
        rejected: d.rejected,
        uploadedAt: d.uploadedAt,
        source: d.source,
      })),
    ]
    pageData.liveCapture = {
      dataset: liveLogin.dataset?.name ?? null,
      rows: liveLogin.analysis.metrics.attempts,
      failed: liveLogin.failed,
      granted: liveLogin.granted,
      autoFetch: liveLogin.status === 'live',
    }
  }

  return {
    page: {
      id: component.id,
      name: component.name,
      group: component.group,
      route: pathname,
    },
    viewer: {
      name: viewer.name ?? 'Demo User',
      role,
      access:
        role === 'ADMIN'
          ? 'Full workspace: investigation, data ingestion, simulation and export.'
          : 'Investigation only. Data uploads, the what-if simulator and bulk export are admin-only.',
      restrictedModules: role === 'ADMIN' ? [] : ['Data Uploads', 'What-If Simulator', 'Alert queue export'],
    },
    asOf: DEMO_NOW.toISOString(),
    workspace: {
      scope: { id: scope.id, kind: scope.kind, label: scope.label, detail: scope.detail },
      datasetCount: contextDatasets.length,
      datasets: uploadDatasets
        .filter((d) => d.assets.length > 0)
        .slice(0, 20)
        .map((d) => ({ id: d.id, name: d.name, assets: d.assets.length })),
      note: 'The workspace dataset scope decides which inventory and correlated alerts are shown. Threat intel from NVD, CISA KEV and FIRST EPSS stays live in every scope. The live Northwind portal capture is a Logs dataset for the anomaly board and does not change the asset scope.',
    },
    organisation: {
      postureScore: livePosture,
      postureDefinition:
        'Posture score is 0-100 and higher is better. Deduction = 15 × CRITICAL alerts + 6 × HIGH alerts; posture = round(100 × e^(-deduction ÷ 100)), so it decays with diminishing returns and never collapses to a flat zero. Patching an asset raises the score.',
      activeAlerts: liveCounts.active,
      critical: liveCounts.critical,
      high: liveCounts.high,
      medium: liveCounts.medium,
      low: liveCounts.low,
      suppressed: liveCounts.suppressed,
      totalCandidates: liveCounts.total,
      kevLinked: liveActive.filter((a) => a.cve.kev).length,
      internetFacingAlerting: liveActive.filter((a) => a.asset.internetFacing).length,
      versionUnknown: liveActive.filter((a) => a.relevance === 'VERSION_UNKNOWN').length,
      inventoryCoverage: `${mergedAssets.length} ${plural(mergedAssets.length, 'asset')} in ${scope.label}${uploadedAssets.length ? ` (${uploadedAssets.length} from user uploads)` : ''}, version-aware on ${verifiedAssets} of ${mergedAssets.length}`,
      assets: mergedAssets.length,
      departments: [...new Set(mergedAssets.map((a) => a.department))],
    },
    scoring: {
      formulaVersion: FORMULA_VERSION,
      weights: WEIGHTS,
      levels: 'CRITICAL ≥85, HIGH ≥65, MEDIUM ≥40, LOW below 40; relevance gate suppresses NOT_AFFECTED and PRODUCT_ABSENT.',
      thresholds: { critical: 85, high: 65, medium: 40 },
    },
    machineLearning: {
      model: 'XGBoost gradient-boosted trees',
      version: MODEL_CARD.version,
      objective: MODEL_CARD.objective,
      target: MODEL_CARD.target,
      trainedAt: MODEL_CARD.trainedAt,
      rows: MODEL_CARD.dataset.rows,
      features: MODEL_CARD.featureImportance.length,
      rounds: MODEL_CARD.rounds,
      cvAuc: MODEL_CARD.cv.auc,
      testAuc: MODEL_CARD.test.auc,
      testLogloss: MODEL_CARD.test.logloss,
      brier: MODEL_CARD.test.brier,
      topFeatures: MODEL_CARD.featureImportance.slice(0, 6),
      portfolio: {
        coverage: liveMl.portfolio.coverage,
        meanProbability: Math.round(liveMl.portfolio.mean * 1000) / 1000,
        maxProbability: Math.round(liveMl.portfolio.max * 1000) / 1000,
        elevated: liveMl.portfolio.elevated,
        watch: liveMl.portfolio.watch,
        low: liveMl.portfolio.low,
      },
      policy:
        `XGBoost is a second opinion on KEV membership (observed in-the-wild exploitation), not a replacement for the six-factor score. It is fitted on live NVD, EPSS and KEV snapshots, with the KEV label excluded from the features. Suppressed alerts still receive a prior for audit, but the version-relevance gate overrides the model. Bands: ELEVATED ≥${(ML_BANDS.elevated * 100).toFixed(1)}%, WATCH ≥${(ML_BANDS.watch * 100).toFixed(1)}%, LOW below.`,
    },
    topAlerts: top.map(slimAlert),
    suppressed: liveSuppressed.map(slimAlert),
    patchPlan,
    sources: currentLiveSourceHealth().map((s) => ({
      source: s.source,
      status: s.status,
      kind: s.kind,
      lastSuccess: s.lastSuccess,
      note: s.note,
    })),
    anomalies: {
      flagged: flagged.map((w) => ({
        window: w.label,
        account: w.account ?? null,
        sourceIp: w.sourceIp ?? null,
        outcome: w.failedLogins > 0 ? 'FAILED' : 'GRANTED',
        reason: w.reason ?? 'anomalous window',
        failedLogins: w.failedLogins,
        distinctIps: w.distinctIps,
        rps: w.rps,
        riskScore: w.riskScore ?? null,
        score: w.anomalyScore,
      })),
      baselineNote: liveWindows.length
        ? 'One window per live sign-in request. Every failed request is flagged and counted; the cumulative risk score sets the severity.'
        : 'A window is flagged when failed logins, source diversity or request rate move outside the seeded baseline.',
    },
    liveLogin: {
      status: liveLogin.status,
      source: 'Northwind decoy portal · fictional demo accounts',
      lastSync: liveLogin.lastSync,
      pollSeconds: LOGIN_POLL_MS / 1000,
      dataset: liveLogin.dataset
        ? {
            id: liveLogin.dataset.id,
            name: liveLogin.dataset.name,
            type: liveLogin.dataset.type,
            rows: liveLogin.dataset.rows,
            failed: liveLogin.failed,
            granted: liveLogin.granted,
            autoFetch: liveLogin.status === 'live',
            files: liveLogin.dataset.files ?? null,
          }
        : null,
      windows: liveWindows.length,
      flaggedWindows: flagged.length,
      risk: {
        score: loginAnalysis.score,
        rawScore: loginAnalysis.rawScore,
        level: loginAnalysis.level,
        verdict: loginAnalysis.verdict,
        delta: loginAnalysis.scoreDelta,
        windowSeconds: Math.round(loginAnalysis.windowMs / 1000),
        firstAt: loginAnalysis.firstAt,
        lastAt: loginAnalysis.lastAt,
      },
      metrics: loginAnalysis.metrics,
      contributors: loginAnalysis.contributors,
      findings: loginAnalysis.findings.map((finding) => ({
        severity: finding.severity,
        title: finding.title,
        detail: finding.detail,
        evidence: finding.evidence,
        technique: finding.technique,
        action: finding.action,
      })),
      techniques: loginAnalysis.techniques,
      accounts: loginAnalysis.accounts.slice(0, 8),
      sources: loginAnalysis.sources.slice(0, 8),
      takeover: loginAnalysis.takeover,
      impossibleTravel: loginAnalysis.impossibleTravel,
      narrative: loginAnalysis.narrative,
      recommendations: loginAnalysis.recommendations,
      recentEvents: loginRecent.map((event) => ({
        id: event.id,
        at: event.at,
        email: event.email,
        success: event.success,
        sourceIp: event.sourceIp,
        country: event.country,
        city: event.city,
        reason: event.reason,
        isTor: Boolean(event.isTor),
        simulated: Boolean(event.simulated),
      })),
      note: loginAnalysis.metrics.attempts
        ? `The live capture is ingested automatically as the Logs dataset "${liveLogin.dataset?.name ?? 'Northwind portal logins'}". Every failed request is flagged and counted individually; the cumulative risk score is deterministic. Accounts, addresses and geolocation are fictional demo values, and passwords are never stored.`
        : 'No portal sign-ins have been captured yet. The decoy portal writes portal/data/login-events.json and .csv, and Aegis polls it automatically. Do not invent capture numbers.',
    },
    traffic: {
      latest: trafficSeries.slice(-12).map((t) => ({
        time: t.time,
        rps: t.rps,
        failed: t.failed,
        anomaly: t.anomaly,
      })),
      note: 'Traffic and authentication events are simulated demo telemetry, not live observations.',
    },
    intel: intelItems.slice(0, 8).map((i) => ({
      id: i.id,
      source: i.source,
      title: i.title,
      category: i.category,
      simulated: Boolean(i.simulated),
    })),
    inventory: {
      byType,
      byCriticality,
      internetFacing: mergedAssets.filter((a) => a.internetFacing).length,
      unverifiedSoftware: mergedAssets
        .filter((a) => a.software.some((s) => !s.version || s.version === 'unknown'))
        .map((a) => a.name),
    },
    userUploads: {
      datasetCount: contextDatasets.length,
      assetsTotal: uploadedAssets.length,
      datasets: contextDatasets.slice(0, 20).map((d) => ({
        name: d.name,
        type: d.type,
        status: d.status,
        rows: d.rows,
        accepted: d.accepted,
        rejected: d.rejected,
        uploadedAt: d.uploadedAt,
        source: d.source ?? 'USER UPLOAD',
        live: Boolean(d.live),
        failedLogins: d.logs?.failedLogins ?? null,
      })),
      assets: uploadedAssets.slice(0, 50).map((a) => ({
        name: a.name,
        type: a.type,
        department: a.department,
        criticality: a.criticality,
        internetFacing: a.internetFacing,
        software: a.software.map((s) => `${s.vendor} ${s.product} ${s.version}`),
      })),
      logs: contextDatasets
        .filter((d) => d.logs)
        .slice(0, 20)
        .map((d) => ({
          dataset: d.name,
          total: d.logs!.total,
          failedLogins: d.logs!.failedLogins,
          distinctIps: d.logs!.distinctIps,
          destinations: d.logs!.destinations,
          countries: d.logs!.countries,
          firstTimestamp: d.logs!.firstTimestamp,
          lastTimestamp: d.logs!.lastTimestamp,
        })),
      note:
        contextDatasets.length > 0
          ? `These datasets are shown in the Data Input Hub. The live Northwind portal capture (${liveLogin.analysis.metrics.attempts} login requests, ${liveLogin.failed} failed) is auto-fetched as a Logs dataset and does not change the asset scope. Any remaining datasets were accepted by an admin. Logs are summarised, not replayed event by event. The current workspace scope is ${scope.label}.`
          : `No datasets have arrived yet. The workspace scope is ${scope.label}. Open the decoy portal to produce a live login capture.`,
    },
    pageData,
    policy:
      'Demo seed: assets, logs, authentication events, geolocation and traffic are simulated. The live login capture is written by the local Northwind decoy portal and auto-ingested as a Logs dataset; its accounts, addresses and geolocation are fictional and passwords are never stored. There is no dedicated login page or login-screen component: the auto-ingested capture is examined on the Dashboard capture strip, the Anomalies attempt register and the Data Input Hub dataset history. NVD, CISA KEV and FIRST EPSS identifiers are real public records; CERT-In is a sample feed; MITRE ATT&CK is a trimmed offline subset. Never present demo telemetry as a real observation.',
  }
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export class AiError extends Error {
  code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'AiError'
    this.code = code
  }
}

function parseSseBlock(block: string): string {
  let out = ''
  for (const rawLine of block.split('\n')) {
    const line = rawLine.trim()
    if (!line.startsWith('data:')) continue
    const data = line.slice(5).trim()
    if (!data || data === '[DONE]') continue
    try {
      const json = JSON.parse(data)
      const delta = json?.choices?.[0]?.delta?.content
      if (typeof delta === 'string' && delta) out += delta
    } catch {
      /* keep-alive or non-JSON event */
    }
  }
  return out
}

export async function streamAnalyst({
  messages,
  context,
  mode = 'chat',
  signal,
  onDelta,
}: {
  messages: ChatMessage[]
  context: AnalystContext
  mode?: 'chat' | 'briefing'
  signal?: AbortSignal
  onDelta: (delta: string) => void
}): Promise<string> {
  let response: Response
  try {
    response = await fetch('/api/ai/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages, context, mode }),
      signal,
    })
  } catch (err: any) {
    if (err?.name === 'AbortError') throw err
    throw new AiError('NETWORK', 'Could not reach the analyst service. Check that the dev server is running.')
  }

  if (!response.ok) {
    let code = `HTTP_${response.status}`
    let message = 'The analyst service returned an error.'
    try {
      const data = await response.json()
      code = data?.error?.code ?? code
      message = data?.error?.message ?? message
    } catch {
      /* non-JSON error */
    }
    if (response.status === 503) {
      message = 'The AI analyst is not configured. Set RIVER_API_KEY in the server environment.'
    }
    throw new AiError(code, message)
  }

  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.includes('text/event-stream')) {
    const data = await response.json().catch(() => null)
    const content = data?.choices?.[0]?.message?.content
    if (typeof content === 'string' && content.trim()) {
      onDelta(content)
      return content
    }
    throw new AiError('UNEXPECTED_RESPONSE', 'The analyst service returned an unexpected response.')
  }

  if (!response.body) throw new AiError('NO_BODY', 'The analyst service returned an empty stream.')

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let full = ''

  const consume = (block: string) => {
    const piece = parseSseBlock(block)
    if (piece) {
      full += piece
      onDelta(piece)
    }
  }

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const blocks = buffer.split(/\r?\n\r?\n/)
    buffer = blocks.pop() ?? ''
    for (const block of blocks) consume(block)
  }

  if (buffer.trim()) {
    buffer += decoder.decode()
    consume(buffer)
  }

  return full
}

export function localBriefing(ctx: AnalystContext): string {
  const org = ctx.organisation
  const [first, second, third] = ctx.topAlerts
  const patch = ctx.patchPlan[0]
  const anomaly = ctx.anomalies.flagged[0]
  const login = ctx.liveLogin
  const loginFinding = login.findings[0]
  const degraded = ctx.sources.filter((s) => s.status === 'DEGRADED')

  const lines: string[] = []
  lines.push(
    `**Bottom line.** Posture score is **${org.postureScore}/100** for **${ctx.workspace.scope.label}** (higher is better) with **${org.activeAlerts} active alerts**, including **${org.critical} critical** and **${org.kevLinked} KEV-linked** cases.`,
  )
  if (login.metrics.attempts > 0) {
    lines.push(
      `The live Northwind capture holds **${login.metrics.attempts} sign-in ${login.metrics.attempts === 1 ? 'request' : 'requests'}** — **${login.metrics.failures} failed**, **${login.metrics.successes} granted** — across ${login.metrics.accounts} ${plural(login.metrics.accounts, 'account')} and ${login.metrics.ips} source ${plural(login.metrics.ips, 'address', 'addresses')}. Login risk is **${login.risk.score}/100 ${login.risk.level}** (${login.risk.verdict}).`,
    )
  }
  lines.push('')
  lines.push('**What matters now**')
  const bullets = [first, second, third].filter(Boolean)
  for (const alert of bullets) {
    lines.push(
      `- **${alert.cve} · ${alert.asset}** scores **${alert.score}** (${alert.level}). ${truncate(alert.action, 120)}`,
    )
  }
  lines.push('')
  lines.push('**Do next**')
  if (patch) {
    lines.push(
      `1. Patch **${patch.asset}** first: ${patch.alertCount} alert${patch.alertCount === 1 ? '' : 's'} (${patch.cves.join(', ')}). Projected posture improves ${patch.currentPosture} → **${patch.projectedPosture}** (+${patch.postureGain} points).`,
    )
  }
  lines.push(
    `2. ${org.versionUnknown > 0 ? `Verify the ${org.versionUnknown} unverified version${org.versionUnknown === 1 ? '' : 's'} so the relevance gate can score them.` : 'Keep the version gate current so suppressed candidates stay suppressed for the right reason.'}`,
  )
  lines.push(
    `3. ${
      loginFinding
        ? `Act on the live capture: **${loginFinding.title}** — ${truncate(loginFinding.action, 120)}`
        : anomaly
          ? `Have the SOC review the ${anomaly.window} attempt: ${truncate(anomaly.reason, 80).replace(/\.$/, '')}.`
          : 'Open the decoy portal and fail a sign-in so the live capture dataset has something to score.'
    }`,
  )
  lines.push('')
  lines.push('**Model second opinion**')
  lines.push(
    `XGBoost **${MODEL_CARD.version}** (${MODEL_CARD.rounds} trees, test AUC **${MODEL_CARD.test.auc.toFixed(3)}**) puts **${ctx.machineLearning.portfolio.elevated} of ${ctx.machineLearning.portfolio.coverage}** active alerts above ${(ML_BANDS.elevated * 100).toFixed(1)}% KEV-membership likelihood; the highest prior is **${(ctx.machineLearning.portfolio.maxProbability * 100).toFixed(0)}%**. The deterministic score stays authoritative — the model is a cross-check, not a replacement.`,
  )
  if (ctx.userUploads.datasetCount > 0) {
    lines.push('')
    const { assetsTotal, datasetCount } = ctx.userUploads
    const scope = ctx.workspace.scope
    const customerLine =
      scope.kind === 'dataset'
        ? `${assetsTotal} uploaded ${plural(assetsTotal, 'asset')} from the ${scope.label} dataset ${assetsTotal === 1 ? 'forms' : 'form'} this scope`
        : `${assetsTotal} uploaded ${plural(assetsTotal, 'asset')} from ${datasetCount} accepted ${plural(datasetCount, 'dataset')} ${scope.kind === 'live' ? 'are included alongside the demo estate' : 'form the All uploads scope'}`
    lines.push(`**Customer data.** ${customerLine}.`)
  }
  lines.push('')
  lines.push(
    `**Data note.** Posture and CVE telemetry are simulated${degraded.length ? `; ${degraded.map((d) => d.source).join(', ')} is marked degraded` : ''}. The login capture comes from the fictional Northwind decoy portal and is auto-ingested as a dataset; passwords are never stored. Scores are deterministic.`,
  )
  return lines.join('\n')
}
