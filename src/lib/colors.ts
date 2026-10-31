import type { RiskLevel, SourceName } from './types'

export const TEAL = '#3ed2c1'
export const AMBER = '#e3a455'
export const SIMULATED = '#9b7bd4'
export const UPLOAD = '#1fbfbf'
export const SUPPRESSED = '#6b7a8d'

export const LEVEL_COLORS: Record<RiskLevel, string> = {
  CRITICAL: '#e5545a',
  HIGH: '#e08a2f',
  MEDIUM: '#e6c229',
  LOW: '#3fae74',
}

export const levelColor = (level: RiskLevel, suppressed?: boolean) =>
  suppressed ? SUPPRESSED : LEVEL_COLORS[level]

export const sourceColor = (source: SourceName | string, simulated?: boolean) => {
  if (simulated) return SIMULATED
  if (source === 'USER UPLOAD') return UPLOAD
  if (source === 'MITRE ATT&CK' || source === 'CERT-In' || source === 'SIMULATED') return SIMULATED
  return TEAL
}

export const hexA = (hex: string, alpha: number) => {
  const v = hex.replace('#', '')
  const r = parseInt(v.slice(0, 2), 16)
  const g = parseInt(v.slice(2, 4), 16)
  const b = parseInt(v.slice(4, 6), 16)
  return `rgba(${r},${g},${b},${alpha})`
}
