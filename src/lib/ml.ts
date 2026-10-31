import modelJson from '../data/xgb-model.json'
import cardJson from '../data/xgb-model-card.json'
import { activeAlerts, alerts } from '../data/seed'
import type { Alert } from './types'

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
  bands: { elevated: number; watch: number }
  feeds?: { kevCatalog: string; epssModel: string; nvdYears: string; fetchedAt: string }
  featureImportance: FeatureImportance[]
  disclaimer: string
}

export const MODEL: RuntimeModel = modelJson as RuntimeModel
export const MODEL_CARD: ModelCard = cardJson as ModelCard

export const FEATURE_LABELS: Record<string, string> = {
  cvss: 'CVSS base',
  epss: 'EPSS score',
  epss_percentile: 'EPSS percentile',
  epss_x_cvss: 'EPSS × CVSS',
  attack_vector_network: 'Network attack vector',
  attack_complexity_low: 'Low attack complexity',
  privileges_none: 'No privileges required',
  user_interaction_none: 'No user interaction',
}

const vectorFlag = (vector: string, flag: string) => (vector.split('/').includes(flag) ? 1 : 0)

export function featureRow(alert: Alert): Record<string, number> {
  const cvss = alert.cve.cvss ?? 0
  const epss = alert.cve.epss ?? 0
  const vector = alert.cve.vector ?? ''
  const privileges = vectorFlag(vector, 'PR:N') || vectorFlag(vector, 'Au:N')
  return {
    cvss,
    epss,
    epss_percentile: alert.cve.epssPercentile ?? 0,
    epss_x_cvss: epss * cvss,
    attack_vector_network: vectorFlag(vector, 'AV:N'),
    attack_complexity_low: vectorFlag(vector, 'AC:L'),
    privileges_none: privileges,
    user_interaction_none: vectorFlag(vector, 'UI:N'),
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

export const ML_BANDS = MODEL_CARD.bands

export function bandFor(p: number): MlBand {
  if (p >= ML_BANDS.elevated) return 'ELEVATED'
  if (p >= ML_BANDS.watch) return 'WATCH'
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
  elevated: probabilities.filter((p) => p >= ML_BANDS.elevated).length,
  watch: probabilities.filter((p) => p >= ML_BANDS.watch && p < ML_BANDS.elevated).length,
  low: probabilities.filter((p) => p < ML_BANDS.watch).length,
  top: mlActive.slice(0, 5),
  coverage: mlActive.length,
  auc: MODEL_CARD.test.auc,
  cvAuc: MODEL_CARD.cv.auc,
  rounds: MODEL_CARD.rounds,
  rows: MODEL_CARD.dataset.rows,
}

export const topFeatureImportance = MODEL_CARD.featureImportance.slice(0, 6)

export function featureValueLabel(feature: string, value: number): string {
  if (feature.startsWith('attack_') || feature === 'privileges_none' || feature === 'user_interaction_none') {
    return value >= 0.5 ? 'yes' : 'no'
  }
  if (feature === 'epss' || feature === 'epss_percentile') return `${(value * 100).toFixed(1)}%`
  if (feature === 'cvss') return value.toFixed(1)
  return value.toFixed(2)
}
