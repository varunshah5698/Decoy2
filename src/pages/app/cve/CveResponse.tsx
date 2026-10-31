import { useEffect, useState } from 'react'
import { Copy, RotateCcw, Siren } from 'lucide-react'
import { ArrowRight, Check, ChevronDown, X } from '../../../components/Icons'
import { clamp, cx, fmtDateTime, fmtPct, timeAgo } from '../../../lib/format'
import {
  OWNERS,
  PRIORITIES,
  SLA_DAYS,
  STAGES,
  stageIndex,
  stageLabel,
  useCveWorkflow,
  type LogKind,
  type Priority,
  type Stage,
} from './useCveWorkflow'
import type { Alert, Cve } from '../../../lib/types'

const PLAYBOOK: { stage: Stage; checks: { id: string; label: string }[] }[] = [
  {
    stage: 'triage',
    checks: [
      { id: 'triage-impact', label: 'Confirm business impact and asset ownership' },
      { id: 'triage-range', label: 'Validate the CPE range against installed versions' },
      { id: 'triage-assign', label: 'Assign a response owner and priority' },
    ],
  },
  {
    stage: 'assess',
    checks: [
      { id: 'assess-version', label: 'Verify the installed version on each exposed host' },
      { id: 'assess-exposure', label: 'Confirm internet reachability and data sensitivity' },
      { id: 'assess-exploit', label: 'Review EPSS, KEV and exploit-intel context' },
    ],
  },
  {
    stage: 'contain',
    checks: [
      { id: 'contain-compensate', label: 'Apply a compensating control or restrict reachability' },
      { id: 'contain-snapshot', label: 'Snapshot the host for forensic rollback' },
      { id: 'contain-notify', label: 'Notify the owning team and incident bridge' },
    ],
  },
  {
    stage: 'remediate',
    checks: [
      { id: 'remediate-upgrade', label: 'Upgrade the component to the published fix version' },
      { id: 'remediate-restart', label: 'Restart the affected service and validate health' },
      { id: 'remediate-canary', label: 'Canary-check the business flow end to end' },
    ],
  },
  {
    stage: 'verify',
    checks: [
      { id: 'verify-rescan', label: 'Re-scan the host and confirm the version' },
      { id: 'verify-alerts', label: 'Close or suppress correlated alerts' },
      { id: 'verify-graph', label: 'Update the CMDB and asset graph' },
    ],
  },
]

const TOTAL_CHECKS = PLAYBOOK.reduce((sum, group) => sum + group.checks.length, 0)

const KIND_LABEL: Record<LogKind, string> = {
  stage: 'Stage',
  owner: 'Owner',
  priority: 'Priority',
  check: 'Check',
  note: 'Note',
  incident: 'Incident',
}

const fmtSpan = (ms: number) => {
  const minutes = Math.max(1, Math.round(ms / 60000))
  if (minutes < 60) return `${minutes}m`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours}h`
  return `${Math.round(hours / 24)}d`
}

export function CveResponse({
  cve,
  alerts,
  priority,
}: {
  cve: Cve
  alerts: Alert[]
  priority: Priority
}) {
  const flow = useCveWorkflow((s) => s.flows[cve.id])
  const setStage = useCveWorkflow((s) => s.setStage)
  const setOwner = useCveWorkflow((s) => s.setOwner)
  const setPriority = useCveWorkflow((s) => s.setPriority)
  const toggleCheck = useCveWorkflow((s) => s.toggleCheck)
  const addNote = useCveWorkflow((s) => s.addNote)
  const raiseIncident = useCveWorkflow((s) => s.raiseIncident)
  const reset = useCveWorkflow((s) => s.reset)

  const stage = flow?.stage ?? 'triage'
  const owner = flow?.owner ?? null
  const checks = flow?.checks ?? []
  const startedAt = flow?.startedAt ?? null
  const incidentId = flow?.incidentId ?? null
  const log = flow?.log ?? []
  const effPriority = flow?.priority ?? priority
  const idx = stageIndex(stage)
  const checkedIds = new Set(checks)

  const [openStages, setOpenStages] = useState<Stage[]>([stage])
  const [note, setNote] = useState('')
  const [flash, setFlash] = useState<string | null>(null)
  const [confirmReset, setConfirmReset] = useState(false)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    setOpenStages((prev) => (prev.includes(stage) ? prev : [...prev, stage]))
  }, [stage])

  const checkedTotal = PLAYBOOK.reduce(
    (sum, group) => sum + group.checks.filter((check) => checkedIds.has(check.id)).length,
    0,
  )
  const progress = Math.round((checkedTotal / TOTAL_CHECKS) * 100)
  const stageDone = (key: Stage) =>
    PLAYBOOK.find((group) => group.stage === key)?.checks.filter((check) => checkedIds.has(check.id))
      .length ?? 0

  const slaDays = SLA_DAYS[effPriority]
  const due = startedAt ? new Date(new Date(startedAt).getTime() + slaDays * 86_400_000) : null
  const remaining = due ? due.getTime() - now : null
  const overdue = remaining != null && remaining < 0
  const elapsed =
    startedAt && due
      ? clamp((now - new Date(startedAt).getTime()) / (slaDays * 86_400_000), 0, 1)
      : 0
  const clockTone = !startedAt ? 'idle' : overdue ? 'overdue' : elapsed > 0.75 ? 'soon' : 'ok'
  const clockHeadline = !startedAt
    ? 'Not started'
    : overdue
      ? `Overdue ${fmtSpan(-(remaining ?? 0))}`
      : `Due in ${fmtSpan(remaining ?? 0)}`
  const clockSub = !startedAt
    ? `${slaDays}-day window starts with your first action`
    : due
      ? `Due ${fmtDateTime(due.toISOString())} · started ${timeAgo(startedAt)}`
      : ''

  const reco = alerts.reduce<Alert | null>((winner, alert) => {
    if (alert.suppressed) return winner
    return !winner || alert.score > winner.score ? alert : winner
  }, null)

  const copy = async (text: string, kind: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setFlash(kind)
    } catch {
      setFlash('error')
    }
    window.setTimeout(() => setFlash(null), 2400)
  }

  const moveStage = (next: Stage) => {
    setStage(cve.id, next, effPriority)
    setOpenStages((prev) => (prev.includes(next) ? prev : [...prev, next]))
  }

  const handoff = () => {
    const exposed = alerts
      .filter((alert) => !alert.suppressed)
      .map((alert) => `${alert.asset.name} (${alert.asset.id}) · ${alert.relevance} · installed ${alert.version}`)
    const open = PLAYBOOK.flatMap((group) =>
      group.checks
        .filter((check) => !checkedIds.has(check.id))
        .map((check) => `${stageLabel(group.stage)} · ${check.label}`),
    )
    return [
      `CVE response handoff — ${cve.id}`,
      cve.title,
      `Severity ${cve.severity} · CVSS ${cve.cvss?.toFixed(1) ?? '—'} · EPSS ${cve.epss == null ? '—' : fmtPct(cve.epss)} · ${cve.kev ? 'CISA KEV' : 'not in KEV'}`,
      `Priority ${effPriority} · Stage ${stageLabel(stage)} · Owner ${owner ?? 'unassigned'}`,
      `SLA ${due ? `${overdue ? 'OVERDUE' : 'due'} ${fmtDateTime(due.toISOString())}` : 'clock not started'}`,
      `Incident ${incidentId ?? 'none'}`,
      `Exposed: ${exposed.length ? exposed.join('; ') : 'no correlated asset'}`,
      `Open checks: ${open.length ? open.join('; ') : 'none'}`,
    ].join('\n')
  }

  const requestReset = () => {
    if (!confirmReset) {
      setConfirmReset(true)
      window.setTimeout(() => setConfirmReset(false), 4000)
      return
    }
    reset(cve.id)
    setConfirmReset(false)
    setNote('')
    setOpenStages(['triage'])
  }

  const submitNote = () => {
    if (!note.trim()) return
    addNote(cve.id, note, effPriority)
    setNote('')
  }

  return (
    <div className="cve-ws-response">
      <div className={cx('cve-ws-status', !flow && 'is-idle')}>
        <div>
          <span className="mono">{flow ? 'Response in progress' : 'Response not started'}</span>
          <strong>{flow ? stageLabel(stage) : `${effPriority} · ready for triage`}</strong>
          <p>
            {flow
              ? STAGES[idx]?.caption
              : 'Choose a priority, name an owner, and tick the first check to start the SLA clock.'}
          </p>
        </div>
        <div className="cve-ws-status-meter">
          <span className="cve-ws-status-pct">
            {progress}
            <small>%</small>
          </span>
          <span className="mono">
            playbook complete · {checkedTotal}/{TOTAL_CHECKS}
          </span>
          <div className="bar">
            <i style={{ width: `${progress}%` }} />
          </div>
          {flow && startedAt && <span className={cx('cve-ws-status-sla', `tone-${clockTone}`)}>{clockHeadline}</span>}
        </div>
      </div>

      <div className="cve-ws-reco">
        <div>
          <span className="mono">Recommended remediation{reco ? ` · ${reco.asset.name}` : ''}</span>
          <p>
            {reco
              ? reco.action
              : 'No inventory exposure. Keep the record on watch and re-run correlation after the next live pull.'}
          </p>
        </div>
        {reco && (
          <button type="button" className="cve-ws-textbtn" onClick={() => void copy(reco.action, 'reco')}>
            <Copy size={11} /> {flash === 'reco' ? 'Copied' : 'Copy'}
          </button>
        )}
      </div>

      <section className="cve-ws-panel">
        <header className="cve-ws-panel-head">
          <span className="mono">Response stages</span>
          <span className="cve-ws-panel-meta">
            {checkedTotal}/{TOTAL_CHECKS} checks · {Math.round((checkedTotal / TOTAL_CHECKS) * 100)}%
          </span>
        </header>
        <div className="cve-ws-rail" role="group" aria-label="Response stages">
          {STAGES.map((entry, index) => (
            <button
              key={entry.key}
              type="button"
              className={cx('cve-ws-step', index < idx && 'done', index === idx && 'now')}
              aria-current={index === idx ? 'step' : undefined}
              onClick={() => moveStage(entry.key)}
            >
              <span className="cve-ws-step-index">{index < idx ? <Check size={10} /> : index + 1}</span>
              <span className="cve-ws-step-label">{entry.label}</span>
              <span className="cve-ws-step-caption">{entry.caption}</span>
              <span className="cve-ws-step-count">
                {stageDone(entry.key)}/3 checks
              </span>
            </button>
          ))}
        </div>
      </section>

      <div className="cve-ws-response-grid">
        <section className="cve-ws-panel">
          <header className="cve-ws-panel-head">
            <span className="mono">Priority & owner</span>
            <span className="cve-ws-panel-meta">{effPriority} window · {slaDays}d</span>
          </header>
          <div className="cve-ws-panel-body">
            <div className="cve-ws-field">
              <span className="cve-ws-field-label">Priority</span>
              <div className="cve-ws-prio-row" role="group" aria-label="Response priority">
                {PRIORITIES.map((entry) => (
                  <button
                    key={entry}
                    type="button"
                    className={cx('cve-ws-prio', entry.toLowerCase(), entry === effPriority && 'on')}
                    aria-pressed={entry === effPriority}
                    onClick={() => setPriority(cve.id, entry)}
                  >
                    <b>{entry}</b>
                    <span>{SLA_DAYS[entry]}d SLA</span>
                  </button>
                ))}
              </div>
              <p className="cve-ws-hint">
                Suggested from severity, exposure and exploit signal. The clock starts on the first action.
              </p>
            </div>

            <div className="cve-ws-field">
              <span className="cve-ws-field-label">Owner</span>
              <div className="cve-ws-owners">
                {OWNERS.map((team) => (
                  <button
                    key={team}
                    type="button"
                    className={cx('chip', 'cve-ws-owner', team === owner && 'is-on')}
                    aria-pressed={team === owner}
                    onClick={() => setOwner(cve.id, team === owner ? null : team, effPriority)}
                  >
                    {team}
                  </button>
                ))}
                {owner && (
                  <button type="button" className="cve-ws-owner-clear" onClick={() => setOwner(cve.id, null, effPriority)}>
                    <X size={9} /> Clear
                  </button>
                )}
              </div>
              <p className="cve-ws-hint">
                {owner
                  ? `${owner} owns this response and receives the handoff brief.`
                  : 'Unassigned. Name an owner before the SLA clock starts.'}
              </p>
            </div>
          </div>
        </section>

        <section className="cve-ws-panel">
          <header className="cve-ws-panel-head">
            <span className="mono">Clock & escalation</span>
            <span className="cve-ws-panel-meta">{effPriority} · {slaDays}d window</span>
          </header>
          <div className={cx('cve-ws-clock', `tone-${clockTone}`)}>
            <span className="mono">Response SLA</span>
            <strong>{clockHeadline}</strong>
            <span className="cve-ws-clock-sub">{clockSub}</span>
            <div className="cve-ws-clock-bar">
              <i style={{ width: `${Math.round(elapsed * 100)}%` }} />
            </div>
          </div>
          <div className="cve-ws-incident">
            <div>
              <span className="mono">Escalation</span>
              <p>
                {incidentId
                  ? `Bridge ${incidentId} is open on this case.`
                  : cve.kev || cve.severity === 'CRITICAL'
                    ? 'This case meets the incident-bridge bar. Opening one moves it to Contain.'
                    : 'Open a bridge if the blast radius grows or the SLA slips.'}
              </p>
            </div>
            {incidentId ? (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => void copy(incidentId, 'incident')}
              >
                <Copy size={12} /> {flash === 'incident' ? 'Copied' : 'Copy ID'}
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => raiseIncident(cve.id, effPriority)}
              >
                <Siren size={13} /> Raise incident
              </button>
            )}
          </div>
        </section>
      </div>

      <div className="cve-ws-response-grid">
        <section className="cve-ws-panel cve-ws-playbook">
          <header className="cve-ws-panel-head">
            <span className="mono">Playbook</span>
            <span className="cve-ws-panel-meta">{checkedTotal}/{TOTAL_CHECKS} complete</span>
          </header>
          <div>
            {PLAYBOOK.map((group, index) => {
              const done = stageDone(group.stage)
              const isOpen = openStages.includes(group.stage)
              const isCurrent = group.stage === stage
              const complete = done === group.checks.length
              return (
                <div
                  key={group.stage}
                  className={cx('cve-ws-group', isCurrent && 'is-current', complete && 'is-done')}
                >
                  <button
                    type="button"
                    className="cve-ws-group-head"
                    aria-expanded={isOpen}
                    onClick={() =>
                      setOpenStages((prev) =>
                        prev.includes(group.stage)
                          ? prev.filter((entry) => entry !== group.stage)
                          : [...prev, group.stage],
                      )
                    }
                  >
                    <span className="cve-ws-group-index">
                      {complete ? <Check size={10} /> : index + 1}
                    </span>
                    <span className="cve-ws-group-name">{STAGES[index].label}</span>
                    <span className="cve-ws-group-count">
                      {done}/{group.checks.length}
                    </span>
                    <ChevronDown size={12} className={isOpen ? 'rot' : undefined} />
                  </button>
                  {isOpen && (
                    <div className="cve-ws-checks">
                      {group.checks.map((check) => {
                        const isDone = checkedIds.has(check.id)
                        return (
                          <button
                            key={check.id}
                            type="button"
                            role="checkbox"
                            aria-checked={isDone}
                            className={cx('cve-ws-check', isDone && 'is-done')}
                            onClick={() => toggleCheck(cve.id, check.id, check.label, effPriority)}
                          >
                            <span className="cve-ws-box">{isDone && <Check size={9} />}</span>
                            <span>{check.label}</span>
                          </button>
                        )
                      })}
                      {isCurrent && complete && index < STAGES.length - 1 && (
                        <button
                          type="button"
                          className="cve-ws-advance"
                          onClick={() => moveStage(STAGES[index + 1].key)}
                        >
                          All checks done — advance to {STAGES[index + 1].label}
                          <ArrowRight size={11} />
                        </button>
                      )}
                      {isCurrent && complete && index === STAGES.length - 1 && (
                        <span className="cve-ws-verified">
                          <Check size={11} /> Verification complete — ready to close
                        </span>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
          <p className="cve-ws-panel-foot">
            Checks and the case log are saved per CVE in this browser. Every tick is logged.
          </p>
        </section>

        <section className="cve-ws-panel cve-ws-activity">
          <header className="cve-ws-panel-head">
            <span className="mono">Case log</span>
            <span className="cve-ws-panel-meta">
              {log.length} {log.length === 1 ? 'event' : 'events'}
            </span>
          </header>
          {log.length === 0 ? (
            <p className="cve-ws-empty">
              No actions yet. Stage changes, owner picks, checks and notes land here with a timestamp.
            </p>
          ) : (
            <ol className="cve-ws-log" role="log" aria-live="polite">
              {[...log].reverse().map((entry) => (
                <li key={entry.id} className={cx('cve-ws-log-item', `kind-${entry.kind}`)}>
                  <span className="cve-ws-log-dot" />
                  <div>
                    <span className="cve-ws-log-kind">{KIND_LABEL[entry.kind]}</span>
                    <p>{entry.text}</p>
                  </div>
                  <time className="mono" dateTime={entry.at}>
                    {timeAgo(entry.at)}
                  </time>
                </li>
              ))}
            </ol>
          )}
          <div className="cve-ws-note">
            <input
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="Add a note to the case log…"
              aria-label="Add a case note"
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  submitNote()
                }
              }}
            />
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={submitNote}
              disabled={!note.trim()}
            >
              Add
            </button>
          </div>
          <div className="cve-ws-activity-foot">
            <button
              type="button"
              className="cve-ws-textbtn"
              onClick={() => void copy(handoff(), 'handoff')}
            >
              <Copy size={11} />
              {flash === 'handoff' ? 'Handoff copied' : flash === 'error' ? 'Copy failed' : 'Copy handoff'}
            </button>
            <button
              type="button"
              className={cx('cve-ws-textbtn', confirmReset && 'is-danger')}
              onClick={requestReset}
            >
              <RotateCcw size={11} /> {confirmReset ? 'Confirm reset' : 'Reset plan'}
            </button>
          </div>
        </section>
      </div>
    </div>
  )
}
