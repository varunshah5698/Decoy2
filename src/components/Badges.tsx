import type { Criticality, RelevanceStatus, RiskLevel, SourceName } from '../lib/types'
import { cx } from '../lib/format'
import { ScoreIcon } from './Icons'

const sourceTone: Record<string, string> = {
  NVD: 'real',
  'CISA KEV': 'real',
  'FIRST EPSS': 'real',
  'MITRE ATT&CK': 'simulated',
  'CERT-In': 'simulated',
  SIMULATED: 'simulated',
  'USER UPLOAD': 'upload',
}

export function SourceBadge({ source, simulated }: { source: SourceName | string; simulated?: boolean }) {
  const tone = simulated ? 'simulated' : (sourceTone[source] ?? 'real')
  return <span className={cx('badge', tone)}>{source}</span>
}

export function SeverityBadge({ level, suppressed }: { level: RiskLevel; suppressed?: boolean }) {
  return (
    <span className={cx('badge', suppressed ? 'suppressed' : level.toLowerCase())}>
      {suppressed ? 'Suppressed' : level}
    </span>
  )
}

export function CriticalityBadge({ level }: { level: Criticality }) {
  return <span className={cx('badge', level.toLowerCase())}>{level}</span>
}

export function RelevanceBadge({ relevance }: { relevance: RelevanceStatus }) {
  const tone =
    relevance === 'MATCHED' ? 'critical' : relevance === 'VERSION_UNKNOWN' ? 'medium' : 'suppressed'
  const label = {
    MATCHED: 'Matched',
    VERSION_UNKNOWN: 'Version unknown',
    NOT_AFFECTED: 'Not affected',
    PRODUCT_ABSENT: 'Product absent',
  }[relevance]
  return <span className={cx('badge', tone)}>{label}</span>
}

export function ConfidenceBadge({ confidence }: { confidence: 'HIGH' | 'MEDIUM' | 'LOW' }) {
  return (
    <span className={cx('chip')}>
      <ScoreIcon size={11} />
      {confidence} confidence
    </span>
  )
}

export function SimulatedBadge() {
  return <span className="badge simulated">Simulated</span>
}

export function UploadBadge() {
  return <span className="badge upload">User upload</span>
}

export function LiveDot({ label }: { label: string }) {
  return (
    <span className="status-line" style={{ marginBottom: 0 }}>
      <i className="status-dot" />
      {label}
    </span>
  )
}
