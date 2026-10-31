import type { Alert } from '../lib/types'
import { fmtScore } from '../lib/format'
import { SeverityBadge } from './Badges'

const FACTORS: { key: keyof Alert['breakdown']; label: string; color: string }[] = [
  { key: 'severity_points', label: 'Severity', color: '#e5545a' },
  { key: 'exploit_points', label: 'EPSS', color: '#e08a2f' },
  { key: 'kev_points', label: 'KEV', color: '#e6c229' },
  { key: 'criticality_points', label: 'Asset criticality', color: '#3ed2c1' },
  { key: 'exposure_points', label: 'Exposure', color: '#9b7bd4' },
  { key: 'relevance_points', label: 'Relevance', color: '#3fae74' },
]

export function Waterfall({ alert, compact = false }: { alert: Alert; compact?: boolean }) {
  const total = alert.score
  return (
    <div className={compact ? 'wf-compact' : undefined}>
      <div className="wf-head">
        <div>
          <div className="wf-cve">
            <strong>{alert.cve.id}</strong>
            <SeverityBadge level={alert.level} suppressed={alert.suppressed} />
          </div>
          <div className="mono" style={{ marginTop: 6 }}>
            Score breakdown · formula v{alert.breakdown.formula_version}
          </div>
        </div>
        <div className="wf-total">
          <div className="score" style={{ color: alert.suppressed ? 'var(--suppressed)' : undefined }}>
            {fmtScore(total)}
          </div>
          <span className="mono">{alert.suppressed ? 'suppressed' : 'risk score'}</span>
        </div>
      </div>
      <div className="wf-rows">
        {FACTORS.map((f) => {
          const raw = alert.breakdown[f.key] as number
          const value = Math.round(raw * 10) / 10
          const width = Math.max(2, Math.min(100, (raw / 25) * 100))
          return (
            <div className="wf-row" key={f.key}>
              <span className="wf-label">{f.label}</span>
              <div className="wf-track">
                <div className="wf-fill" style={{ width: `${width}%`, background: f.color, opacity: value === 0 ? 0.25 : 1 }} />
              </div>
              <span className="wf-val">{value === 0 ? '0.0' : value.toFixed(1)}</span>
            </div>
          )
        })}
      </div>
      <div className="wf-foot">
        <span className="mono">sum → cap 100 → round 1dp</span>
        <span className="mono">version {alert.breakdown.formula_version}</span>
      </div>
      {alert.suppressed && (
        <div className="wf-foot" style={{ borderTop: 0, paddingTop: 8 }}>
          <span className="mono">Relevance gate applied</span>
          <span className="mono" style={{ color: 'var(--medium)' }}>
            would have scored {alert.wouldHaveScored?.toFixed(1)}
          </span>
        </div>
      )}
    </div>
  )
}
