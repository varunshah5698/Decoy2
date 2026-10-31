import { useNavigate } from 'react-router-dom'
import { Lock, ShieldCheck, ArrowRight, KeyRound, Check, X } from '../../components/Icons'
import { Panel } from '../../components/Panel'
import { useAuth, useToast } from '../../lib/store'
import { restrictedRoutes } from '../../lib/access'
import { cx } from '../../lib/format'

export default function Restricted({ moduleName }: { moduleName?: string }) {
  const navigate = useNavigate()
  const session = useAuth((s) => s.session)
  const showToast = useToast((s) => s.show)

  return (
    <div className="page restricted-page">
      <div className="restricted-hero">
        <div className="restricted-badge">
          <Lock size={15} />
        </div>
        <span className="eyebrow">
          <span className="dot" />
          Access control · ADMIN only
        </span>
        <h1>{moduleName ? `${moduleName} is admin-only` : 'Admin approval required'}</h1>
        <p>
          You are signed in as <strong>{session?.role ?? 'ANALYST'}</strong>. Analysts get the full
          investigation surface, but data ingestion and scenario simulation are reserved for admins so the
          evidence trail stays controlled.
        </p>
        <div className="restricted-actions">
          <button className="btn btn-primary btn-sm" onClick={() => navigate('/app')}>
            Back to dashboard <ArrowRight size={13} />
          </button>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => showToast('Access request sent to the workspace admin · demo only')}
          >
            <KeyRound size={13} /> Request access
          </button>
        </div>
      </div>

      <div className="restricted-grid">
        <Panel title="Available to analysts" sub="Triage, investigation and analysis" bodyClass="panel-body">
          <ul className="access-list allowed">
            {[
              'Security dashboard and AI copilot',
              'Alert triage and acknowledgement',
              'Asset, CVE and threat-intel exploration',
              'Scoring model, anomaly and traffic analysis',
              'Network, attack profile and provenance graphs',
            ].map((item) => (
              <li key={item}>
                <Check size={12} /> {item}
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title="Reserved for admins" sub="Changes to platform evidence and state" bodyClass="panel-body">
          <ul className="access-list denied">
            {restrictedRoutes.map((r) => (
              <li key={r.id}>
                <X size={12} />
                <span>
                  <strong>{r.name}</strong>
                  <small>{r.reason}</small>
                </span>
              </li>
            ))}
            <li>
              <X size={12} />
              <span>
                <strong>Evidence export</strong>
                <small>Bulk export of the alert queue stays with administrators.</small>
              </span>
            </li>
          </ul>
        </Panel>
      </div>

      <div className={cx('restricted-note')}>
        <ShieldCheck size={14} />
        <span>
          Need this for an incident? An admin can approve a temporary role change. Every restricted action is
          audited in a real deployment.
        </span>
      </div>
    </div>
  )
}
