import modelJson from '../data/xgb-model.json'
import cardJson from '../data/xgb-model-card.json'
import { activeAlerts, alerts, DEMO_NOW } from '../data/seed'
import { clamp } from './format'
import type { Alert, Criticality } from './types'

interface RuntimeModel {
  format: string
  version: string
  objective: string
  features: string[]
  baseMargin: number
  rounds: number
  trees: number[][][]
}

interface FeatureImportance {
  feature: string
  gain: number
  share: number
}

export interface ModelCard {
  name: string
  version: string
  objective: string
  target: string
  trainedAt: string
  dataset: { rows: number; trainRows: number; testRows: number; positiveRate: number; source: string }
  params: Record<string, number>
  rounds: number
  search: { configs: number; cvFolds: number; bestSearchAuc: number }
  cv: { folds: number; auc: number; logloss: number; bestIteration: number }
  test: { auc: number; logloss: number; brier: number }
  calibration: { bin: string; predicted: number; observed: number; count: number }[]
  featureImportance: FeatureImportance[]
  disclaimer: string
}

export const MODEL: RuntimeModel = modelJson as RuntimeModel
export const MODEL_CARD: ModelCard = cardJson as ModelCard

export const FEATURE_LABELS: Record<string, string> = {
  cvss: 'CVSS base',
  epss: 'EPSS score',
  kev: 'KEV listed',
  internet_facing: 'Internet-facing',
  asset_criticality: 'Asset criticality',
  age_days: 'Alert age (days)',
  confidence: 'Correlation confidence',
  version_verified: 'Version verified',
  deterministic_score: 'Six-factor score',
  patch_available: 'Patch available',
  epss_x_cvss: 'EPSS × CVSS',
  kev_x_epss: 'KEV × EPSS',
  exposure_index: 'Exposure index',
}

const CRIT: Record<Criticality, number> = { HIGH: 3, MEDIUM: 2, LOW: 1 }
const CONFIDENCE: Record<Alert['confidence'], number> = { HIGH: 1, MEDIUM: 0.65, LOW: 0.3 }

export function featureRow(alert: Alert): Record<string, number> {
  const cvss = alert.cve.cvss ?? 0
  const epss = alert.cve.epss ?? 0
  const kev = alert.cve.kev ? 1 : 0
  const internet = alert.asset.internetFacing ? 1 : 0
  const criticality = CRIT[alert.asset.criticality]
  const ageDays = clamp((DEMO_NOW.getTime() - new Date(alert.createdAt).getTime()) / 86_400_000, 0.1, 365)
  return {
    cvss,
    epss,
    kev,
    internet_facing: internet,
    asset_criticality: criticality,
    age_days: ageDays,
    confidence: CONFIDENCE[alert.confidence],
    version_verified: alert.relevance === 'MATCHED' ? 1 : 0,
    deterministic_score: alert.suppressed ? alert.wouldHaveScored ?? 0 : alert.score,
    patch_available: alert.cve.fixVersion ? 1 : 0,
    epss_x_cvss: epss * cvss,
    kev_x_epss: kev * epss,
    exposure_index: internet * (criticality / 3),
  }
}

function leafValue(trees: number[][][], row: number[]): number {
  let z = MODEL.baseMargin
  for (const tree of trees) {
    let node = 0
    while (true) {
      const entry = tree[node]
      const feature = entry[0]
      if (feature < 0) {
        z += entry[5]
        break
      }
      const value = row[feature]
      const left = value < entry[1]
      node = left ? entry[2] : entry[3]
    }
  }
  return z
}

export type MlBand = 'ELEVATED' | 'WATCH' | 'LOW'

export interface MlPrediction {
  probability: number
  logit: number
  band: MlBand
  features: Record<string, number>
}

export function predict(alert: Alert): MlPrediction {
  const features = featureRow(alert)
  const row = MODEL.features.map((f) => features[f] ?? 0)
  const logit = leafValue(MODEL.trees, row)
  const probability = 1 / (1 + Math.exp(-logit))
  return { probability, logit, band: bandFor(probability), features }
}

export function bandFor(p: number): MlBand {
  if (p >= 0.35) return 'ELEVATED'
  if (p >= 0.08) return 'WATCH'
  return 'LOW'
}

export const mlByAlert: Record<string, MlPrediction> = Object.fromEntries(
  alerts.map((a) => [a.id, predict(a)]),
)

export const mlFor = (id: string): MlPrediction => mlByAlert[id] ?? predict(alerts[0])

export const mlActive = activeAlerts
  .map((a) => ({ alert: a, prediction: mlFor(a.id) }))
  .sort((x, y) => y.prediction.probability - x.prediction.probability)

const probabilities = mlActive.map((r) => r.prediction.probability)
const meanProbability = probabilities.reduce((s, p) => s + p, 0) / Math.max(1, probabilities.length)

export const mlPortfolio = {
  mean: meanProbability,
  max: probabilities[0] ?? 0,
  elevated: probabilities.filter((p) => p >= 0.35).length,
  watch: probabilities.filter((p) => p >= 0.08 && p < 0.35).length,
  low: probabilities.filter((p) => p < 0.08).length,
  top: mlActive.slice(0, 5),
  coverage: mlActive.length,
  auc: MODEL_CARD.test.auc,
  cvAuc: MODEL_CARD.cv.auc,
  rounds: MODEL_CARD.rounds,
  rows: MODEL_CARD.dataset.rows,
}

export const topFeatureImportance = MODEL_CARD.featureImportance.slice(0, 6)

export function featureValueLabel(feature: string, value: number): string {
  if (feature === 'kev' || feature === 'internet_facing' || feature === 'version_verified') {
    return value >= 0.5 ? 'yes' : 'no'
  }
  if (feature === 'asset_criticality') return value === 3 ? 'HIGH' : value === 2 ? 'MEDIUM' : 'LOW'
  if (feature === 'confidence') return value >= 1 ? 'HIGH' : value >= 0.5 ? 'MEDIUM' : 'LOW'
  if (feature === 'age_days') return `${value.toFixed(1)} d`
  if (feature === 'cvss') return value.toFixed(1)
  if (feature === 'patch_available') return value >= 0.5 ? 'yes' : 'no'
  return value.toFixed(2)
}
