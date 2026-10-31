import { useMemo, useState } from 'react'
import { Globe2, KeyRound, Lock, Network, Radar, Swords, Zap } from './Icons'
import { techniques } from '../data/seed'
import { cx } from '../lib/format'
import { LEVEL_COLORS, hexA } from '../lib/colors'
import type { RiskLevel } from '../lib/types'

const STAGES = [
  { id: 'TA0001', tactic: 'Initial Access', label: 'Initial Access', icon: Globe2, note: 'Perimetre exposed through a vulnerable edge service or a phished inbox' },
  { id: 'TA0002', tactic: 'Execution', label: 'Execution', icon: Zap, note: 'Attacker code runs on the first foothold host' },
  { id: 'TA0003', tactic: 'Persistence', label: 'Persistence', icon: Lock, note: 'Access survives restarts, credential rotation and cleanup' },
  { id: 'TA0004', tactic: 'Privilege Esc.', label: 'Priv. Escalation', icon: KeyRound, note: 'Local user becomes administrative on the host' },
  { id: 'TA0008', tactic: 'Lateral Movement', label: 'Lateral Movement', icon: Network, note: 'Movement toward domain, database and build systems' },
  { id: 'TA0011', tactic: 'Command & Control', label: 'Command & Control', icon: Radar, note: 'Beaconing over allowed application protocols' },
  { id: 'TA0040', tactic: 'Impact', label: 'Impact', icon: Swords, note: 'Data exfiltration or encryption of business systems' },
] as const

const toneFor = (observed: number): RiskLevel =>
  observed >= 12 ? 'CRITICAL' : observed >= 8 ? 'HIGH' : observed >= 4 ? 'MEDIUM' : 'LOW'

export function AttackChain() {
  const [active, setActive] = useState(0)

  const stages = useMemo(
    () =>
      STAGES.map((s) => {
        const items = techniques.filter((t) => t.tactic === s.tactic).sort((a, b) => b.observed - a.observed)
        const observed = items.reduce((sum, t) => sum + t.observed, 0)
        const level = toneFor(observed)
        return { ...s, items, observed, level, tone: LEVEL_COLORS[level] }
      }),
    [],
  )

  const stage = stages[active]

  return (
    <div className="chain-wrap">
      <div className="chain" onMouseLeave={() => setActive((i) => i)}>
        {stages.map((s, i) => {
          const Icon = s.icon
          return (
            <button
              type="button"
              key={s.id}
              className={cx('chain-step', active === i && 'on')}
              style={{ '--i': i, '--tone': s.tone } as React.CSSProperties}
              onMouseEnter={() => setActive(i)}
              onFocus={() => setActive(i)}
              onClick={() => setActive(i)}
              aria-pressed={active === i}
            >
              <span className="chain-node">
                <Icon size={17} strokeWidth={1.7} />
                <i className="chain-beacon" aria-hidden="true" />
              </span>
              <span className="chain-label">{s.label}</span>
              <span className="chain-meta">
                {s.items.length} tech · {s.observed} obs
              </span>
            </button>
          )
        })}
      </div>

      <div className="chain-detail" key={stage.id}>
        <div className="chain-detail-head">
          <span className="mono">
            {stage.id} · {stage.label.toUpperCase()}
          </span>
          <span className="mono" style={{ color: stage.tone }}>
            {stage.observed} observed events
          </span>
        </div>
        <div className="chain-detail-tags">
          {stage.items.slice(0, 4).map((t) => (
            <span className="chain-tag" key={t.id} title={t.description}>
              {t.id} · {t.name}
            </span>
          ))}
          {stage.items.length > 4 && <span className="chain-tag dim">+{stage.items.length - 4} more</span>}
        </div>
        <p className="chain-note">
          <span style={{ color: hexA(stage.tone, 0.9) }}>Why it matters — </span>
          {stage.note}. Technique presence is illustrative and drawn from the trimmed ATT&CK subset.
        </p>
      </div>
    </div>
  )
}
