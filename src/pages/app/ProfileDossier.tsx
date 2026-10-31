import { useEffect, useMemo, useRef, useState } from 'react'
import { Chart } from '../../components/Chart'
import { AiMarkdown } from '../../components/AiMarkdown'
import { AnalystMark } from '../../components/AnalystMark'
import { SeverityBadge } from '../../components/Badges'
import {
  AlertTriangle,
  ArrowRight,
  Crosshair,
  Network,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  X,
} from '../../components/Icons'
import { attackProfiles, techniques } from '../../data/seed'
import { buildAnalystContext, streamAnalyst, type ChatMessage } from '../../lib/ai'
import { hexA, levelColor } from '../../lib/colors'
import { useAuth } from '../../lib/store'
import { cx } from '../../lib/format'
import type { AttackProfile, Technique } from '../../lib/types'

const NAVY = '#1b2437'
const CORAL = '#f2683c'
const SLATE = '#97a3b4'
const MUTED = '#8b97a9'
const AXIS = 'rgba(27, 36, 55, 0.1)'

const sigla = (name: string) => {
  const words = name.split(/[\s-]+/).filter(Boolean)
  return (words.length > 1 ? words.map((w) => w[0]).join('') : name.slice(0, 2)).toUpperCase().slice(0, 3)
}

export interface ProfileStage {
  index: number
  tactic: string
  note: string
  events: number
  techniques: string[]
}

export interface ProfileMetrics {
  stageRows: ProfileStage[]
  observedTotal: number
  stagedEvents: number
  unstaged: { id: string; name: string; tactic: string; observed: number }[]
  linkedCount: number
  mappedStages: number
  stageCoverage: number
  teams: { name: string; value: number }[]
  rank: number
  eventsRank: string
}

export function profileMetricsFor(profile: AttackProfile, linked: Technique[]): ProfileMetrics {
  const stageRows: ProfileStage[] = profile.stages.map((stage, index) => {
    const inStage = linked.filter((t) => t.tactic === stage.tactic)
    return {
      index,
      tactic: stage.tactic,
      note: stage.note,
      events: inStage.reduce((sum, t) => sum + t.observed, 0),
      techniques: inStage.map((t) => t.id),
    }
  })
  const observedTotal = linked.reduce((sum, t) => sum + t.observed, 0)
  const stagedEvents = stageRows.reduce((sum, s) => sum + s.events, 0)
  const unstaged = linked
    .filter((t) => !profile.stages.some((s) => s.tactic === t.tactic))
    .map((t) => ({ id: t.id, name: t.name, tactic: t.tactic, observed: t.observed }))
  const mappedStages = stageRows.filter((s) => s.techniques.length > 0).length
  const teams = Object.entries(
    profile.mitigations.reduce<Record<string, number>>((acc, control) => {
      acc[control.team] = (acc[control.team] ?? 0) + 1
      return acc
    }, {}),
  )
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name))
  const profileEvents = (p: AttackProfile) =>
    p.techniques
      .map((id) => techniques.find((t) => t.id === id))
      .filter(Boolean)
      .reduce((sum, t) => sum + (t as Technique).observed, 0)
  const rank = 1 + attackProfiles.filter((p) => p.key !== profile.key && profileEvents(p) > observedTotal).length
  const rankCut = Math.ceil(attackProfiles.length * 0.3)
  const eventsRank =
    rank === 1
      ? 'heaviest'
      : rank <= rankCut
        ? 'high-volume'
        : rank <= attackProfiles.length - rankCut
          ? 'median'
          : rank < attackProfiles.length
            ? 'lower-volume'
            : 'lightest'

  return {
    stageRows,
    observedTotal,
    stagedEvents,
    unstaged,
    linkedCount: linked.length,
    mappedStages,
    stageCoverage: profile.stages.length ? Math.round((mappedStages / profile.stages.length) * 100) : 0,
    teams,
    rank,
    eventsRank,
  }
}

export function ProfileDossier({
  profile,
  linked,
  metrics,
}: {
  profile: AttackProfile
  linked: Technique[]
  metrics: ProfileMetrics
}) {
  return (
    <section className="pd-hero mr-card" aria-label={`${profile.name} profile dossier`}>
      <div className="pd-hero-main">
        <span className="pd-avatar" style={{ background: levelColor(profile.defaultSeverity) }} aria-hidden="true">
          {sigla(profile.name)}
        </span>
        <div className="pd-hero-copy">
          <span className="pd-eyebrow mono">ATTACK PROFILE · {profile.category}</span>
          <h2>{profile.name}</h2>
          <p>{profile.description}</p>
          <div className="pd-tags">
            <SeverityBadge level={profile.defaultSeverity} />
            <span className="pd-tag">
              <ShieldCheck size={11} /> {profile.mitigations.length} owned controls
            </span>
            <span className="pd-tag">
              <Crosshair size={11} /> {profile.indicators.length} hunt indicators
            </span>
            <span className="pd-tag">
              <Network size={11} /> {metrics.teams.length} owning team{metrics.teams.length === 1 ? '' : 's'}
            </span>
          </div>
        </div>
      </div>

      <dl className="pd-stats">
        <div>
          <dt>Linked events</dt>
          <dd>{metrics.observedTotal.toLocaleString('en-US')}</dd>
          <span className="mono">rank {metrics.rank} of {attackProfiles.length}</span>
        </div>
        <div>
          <dt>Techniques</dt>
          <dd>
            {metrics.linkedCount}
            <em>/{profile.techniques.length}</em>
          </dd>
          <span className="mono">mapped subset</span>
        </div>
        <div>
          <dt>Stage coverage</dt>
          <dd>{metrics.stageCoverage}%</dd>
          <span className="mono">
            {metrics.mappedStages}/{profile.stages.length} stages
          </span>
        </div>
        <div>
          <dt>Controls</dt>
          <dd>{profile.mitigations.length}</dd>
          <span className="mono">{metrics.teams.length} teams</span>
        </div>
      </dl>
    </section>
  )
}

export function ProfileDepth({
  profile,
  metrics,
  linked,
}: {
  profile: AttackProfile
  metrics: ProfileMetrics
  linked: Technique[]
}) {
  const maxEvents = Math.max(...metrics.stageRows.map((s) => s.events), 1)

  const matrixOption = useMemo(() => {
    const stageTactics = metrics.stageRows.filter((s) => s.techniques.length).map((s) => s.tactic)
    const extraTactics = [...new Set(linked.map((t) => t.tactic))].filter((tactic) => !stageTactics.includes(tactic))
    const tactics = [...stageTactics, ...extraTactics]
    const points = profile.techniques
      .map((id) => techniques.find((t) => t.id === id))
      .filter(Boolean)
      .map((t) => {
        const tech = t as Technique
        return {
          name: tech.id,
          value: [tech.observed, Math.max(0, tactics.indexOf(tech.tactic))],
          tech,
        }
      })
    const maxObserved = Math.max(...points.map((p) => p.value[0] as number), 1)
    return {
      grid: { left: 8, right: 30, top: 26, bottom: 26, containLabel: true },
      xAxis: {
        type: 'value',
        name: 'Observed events',
        nameLocation: 'middle',
        nameGap: 26,
        nameTextStyle: { color: MUTED, fontSize: 8.5, fontFamily: 'JetBrains Mono Variable, monospace' },
        axisLine: { lineStyle: { color: AXIS } },
        axisTick: { show: false },
        axisLabel: { color: MUTED, fontSize: 8.5, fontFamily: 'JetBrains Mono Variable, monospace' },
        splitLine: { lineStyle: { color: AXIS, type: 'dashed' } },
      },
      yAxis: {
        type: 'category',
        data: tactics,
        axisLine: { lineStyle: { color: AXIS } },
        axisTick: { show: false },
        axisLabel: { color: MUTED, fontSize: 8.5, fontFamily: 'JetBrains Mono Variable, monospace' },
      },
      tooltip: {
        formatter: (p: any) => {
          const tech: Technique = p.data.tech
          return `<strong>${tech.id} · ${tech.name}</strong><br/>${tech.tactic}<br/>${tech.observed.toLocaleString('en-US')} observed events`
        },
      },
      series: [
        {
          type: 'scatter',
          data: points,
          symbolSize: (value: number[]) => 16 + 30 * ((value[0] ?? 0) / maxObserved),
          itemStyle: { color: CORAL, borderColor: '#fff', borderWidth: 2, opacity: 0.92 },
          label: {
            show: true,
            position: 'top',
            formatter: (p: any) => p.name,
            color: NAVY,
            fontSize: 8.5,
            fontFamily: 'JetBrains Mono Variable, monospace',
          },
          emphasis: { scale: 1.2 },
        },
      ],
    }
  }, [profile, metrics.stageRows, linked])

  const donutOption = useMemo(() => {
    const palette = [CORAL, NAVY, SLATE, hexA(CORAL, 0.45), hexA(NAVY, 0.4)]
    return {
      tooltip: { trigger: 'item', formatter: '{b}: {c} control(s) ({d}%)' },
      series: [
        {
          type: 'pie',
          radius: ['58%', '84%'],
          center: ['50%', '50%'],
          padAngle: 2,
          minAngle: 10,
          label: { show: false },
          labelLine: { show: false },
          itemStyle: { borderColor: '#fff', borderWidth: 2, borderRadius: 4 },
          data: metrics.teams.map((team, i) => ({
            name: team.name,
            value: team.value,
            itemStyle: { color: palette[i % palette.length] },
          })),
        },
      ],
    }
  }, [metrics.teams])

  return (
    <div className="dash-grid pd-depth">
      <section className="mr-card col-7">
        <header className="mr-card-head">
          <span className="mr-chip" aria-hidden="true">
            <TrendingUp size={15} />
          </span>
          <div className="mr-card-titles">
            <h2>Chain pressure</h2>
            <p>Observed events and mapped techniques at each stage of this profile</p>
          </div>
        </header>
        <div className="mr-card-body">
          <ol className="pd-stage-list">
            {metrics.stageRows.map((stage) => (
              <li className={cx('pd-stage', stage.techniques.length === 0 && 'is-gap')} key={`${stage.tactic}-${stage.index}`}>
                <span className="pd-stage-idx mono">{String(stage.index + 1).padStart(2, '0')}</span>
                <div className="pd-stage-main">
                  <div className="pd-stage-top">
                    <strong>{stage.tactic}</strong>
                    <span className="mono">{stage.events.toLocaleString('en-US')} events</span>
                  </div>
                  <div className="pd-stage-track">
                    <span style={{ width: `${Math.max(stage.events ? 6 : 2, (stage.events / maxEvents) * 100)}%` }} />
                  </div>
                  <div className="pd-stage-meta">
                    <span>{stage.note}</span>
                    {stage.techniques.length ? (
                      <span className="pd-stage-chips">
                        {stage.techniques.map((id) => (
                          <b key={id}>{id}</b>
                        ))}
                      </span>
                    ) : (
                      <span className="pd-stage-gap">No mapped technique — evidence gap</span>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ol>
          {metrics.unstaged.length > 0 && (
            <p className="pd-stage-note">
              {metrics.observedTotal - metrics.stagedEvents} events come from techniques outside these stages:{' '}
              {metrics.unstaged.map((t) => `${t.id} (${t.tactic}, ${t.observed})`).join(' · ')}. They still count in the
              profile total and the technique matrix.
            </p>
          )}
        </div>
      </section>

      <section className="mr-card col-5">
        <header className="mr-card-head">
          <span className="mr-chip" aria-hidden="true">
            <Crosshair size={15} />
          </span>
          <div className="mr-card-titles">
            <h2>Technique impact</h2>
            <p>Bubble size follows observed volume · trimmed ATT&amp;CK subset</p>
          </div>
        </header>
        <div className="mr-card-body">
          <Chart option={matrixOption} height={244} />
        </div>
      </section>

      <section className="mr-card col-5">
        <header className="mr-card-head">
          <span className="mr-chip" aria-hidden="true">
            <ShieldCheck size={15} />
          </span>
          <div className="mr-card-titles">
            <h2>Control ownership</h2>
            <p>Which teams would carry the interruption work</p>
          </div>
        </header>
        <div className="mr-card-body">
          <div className="pd-donut">
            <Chart option={donutOption} height={196} />
            <div className="pd-donut-center">
              <strong>{profile.mitigations.length}</strong>
              <span>controls</span>
            </div>
          </div>
          <ul className="pd-teams">
            {metrics.teams.map((team, i) => (
              <li key={team.name}>
                <i style={{ background: [CORAL, NAVY, SLATE, hexA(CORAL, 0.45), hexA(NAVY, 0.4)][i % 5] }} />
                <span>{team.name}</span>
                <strong className="mono">{team.value}</strong>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="mr-card col-7 pd-hunt">
        <header className="mr-card-head">
          <span className="mr-chip" aria-hidden="true">
            <Crosshair size={15} />
          </span>
          <div className="mr-card-titles">
            <h2>Behaviours to hunt</h2>
            <p>Signals that would show the chain moving, before the final stage</p>
          </div>
          <div className="mr-card-actions">
            <span className="badge low">{profile.indicators.length} indicators</span>
          </div>
        </header>
        <div className="mr-card-body">
          <ol className="pd-hunt-list">
            {profile.indicators.map((indicator, i) => (
              <li key={indicator}>
                <span className="mono">{String(i + 1).padStart(2, '0')}</span>
                <div>
                  <strong>{indicator}</strong>
                  <p>
                    {i === 0
                      ? `Look in ${profile.mitigations[0]?.team ?? metrics.teams[0]?.name ?? 'the owning team'} telemetry and correlate with ${linked[0]?.id ?? 'the first linked technique'}.`
                      : `Confirm against ${linked[(i + 1) % Math.max(linked.length, 1)]?.name ?? 'the linked techniques'} evidence before escalating.`}
                  </p>
                </div>
              </li>
            ))}
          </ol>
          <p className="pd-hunt-note">
            <AlertTriangle size={11} /> Detection hypotheses from this profile, not confirmed sightings in the estate.
            The ATT&amp;CK subset is trimmed, so an absent signal does not prove absence.
          </p>
        </div>
      </section>
    </div>
  )
}

const PROMPTS = [
  'Explain this profile in plain language.',
  'What would this actor try next, and where would we see it?',
  'Which control closes the biggest gap?',
  'How does this profile compare with the rest of the estate?',
]

function useProfileContext(profile: AttackProfile, metrics: ProfileMetrics, linked: Technique[]) {
  const session = useAuth((s) => s.session)

  return useMemo(() => {
    const base = buildAnalystContext('/app/attacks', { role: session?.role, name: session?.name })
    const selectedProfile = {
      name: profile.name,
      key: profile.key,
      category: profile.category,
      description: profile.description,
      defaultSeverity: profile.defaultSeverity,
      stages: metrics.stageRows.map((s) => ({
        stage: s.index + 1,
        tactic: s.tactic,
        note: s.note,
        observedEvents: s.events,
        mappedTechniques: s.techniques,
        evidenceGap: s.techniques.length === 0,
      })),
      techniques: linked.map((t) => ({
        id: t.id,
        name: t.name,
        tactic: t.tactic,
        description: t.description,
        observed: t.observed,
      })),
      mitigations: profile.mitigations,
      indicators: profile.indicators,
      metrics: {
        observedEvents: metrics.observedTotal,
        linkedTechniques: metrics.linkedCount,
        declaredTechniques: profile.techniques.length,
        stageCoverage: metrics.stageCoverage,
        estateRank: metrics.rank,
        estateSize: attackProfiles.length,
        owningTeams: metrics.teams,
      },
      note:
        'The selected attack profile is the subject of this conversation. Profiles are planning artefacts, not attribution: the app never claims this organisation observed the attack. Observed event counts are seeded demo telemetry; the ATT&CK subset is trimmed and offline.',
    }
    return {
      ...base,
      pageData: {
        ...base.pageData,
        selectedProfile,
        profileComparison: attackProfiles.map((p) => ({
          name: p.name,
          category: p.category,
          techniques: p.techniques.length,
          stages: p.stages.length,
          controls: p.mitigations.length,
        })),
      },
      policy: `${base.policy} Attack-profile analysis is planning support. Never attribute an attack to this organisation from a profile alone.`,
    }
  }, [profile, metrics, linked, session?.role, session?.name])
}

export function ProfileAnalyst({
  profile,
  metrics,
  linked,
}: {
  profile: AttackProfile
  metrics: ProfileMetrics
  linked: Technique[]
}) {
  const context = useProfileContext(profile, metrics, linked)
  const [thread, setThread] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const threadRef = useRef<HTMLDivElement>(null)
  const lastPrompt = useRef('')
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    abortRef.current?.abort()
    abortRef.current = null
    setThread([])
    setInput('')
    setStreaming(false)
    setError(null)
    lastPrompt.current = ''
  }, [profile.key])

  useEffect(() => () => abortRef.current?.abort(), [])

  const lastContent = thread[thread.length - 1]?.content ?? ''
  useEffect(() => {
    const el = threadRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [thread.length, lastContent, streaming])

  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(104, el.scrollHeight)}px`
  }, [input])

  const ask = async (raw: string) => {
    const question = raw.trim()
    if (!question || streaming) return
    lastPrompt.current = question
    setError(null)
    setInput('')
    const history: ChatMessage[] = [...thread, { role: 'user', content: question }]
    setThread([...history, { role: 'assistant', content: '' }])
    setStreaming(true)

    const controller = new AbortController()
    abortRef.current = controller
    let acc = ''

    try {
      const full = await streamAnalyst({
        messages: history.slice(-10),
        context,
        signal: controller.signal,
        onDelta: (delta) => {
          if (abortRef.current !== controller) return
          acc += delta
          setThread((prev) => {
            const next = prev.slice()
            next[next.length - 1] = { role: 'assistant', content: acc }
            return next
          })
        },
      })
      const final = (full || acc).trim()
      if (!final) throw new Error('The copilot returned an empty response. Try again.')
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        setThread((prev) => (acc.trim() ? prev : prev.slice(0, -1)))
      } else {
        const fallback = localProfileAnswer(lastPrompt.current, profile, metrics, linked)
        setThread((prev) => {
          const next = prev.slice()
          next[next.length - 1] = { role: 'assistant', content: fallback }
          return next
        })
        setError(
          `${err?.message ?? 'The copilot is unavailable right now.'} A local read from the profile evidence is shown instead.`,
        )
      }
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null
        setStreaming(false)
      }
    }
  }

  const stop = () => {
    abortRef.current?.abort()
    abortRef.current = null
    setStreaming(false)
  }

  return (
    <section className="mr-card pd-analyst" aria-label={`${profile.name} profile analyst`}>
      <header className="mr-card-head">
        <AnalystMark size={30} live={streaming} />
        <div className="mr-card-titles">
          <h2>Profile analyst</h2>
          <p>Reads this profile's chain, techniques, controls and live estate context</p>
        </div>
        <div className="mr-card-actions">
          <span className="pd-model mono">
            <Sparkles size={10} /> LLM · PROFILE-SCOPED
          </span>
        </div>
      </header>
      <div className="mr-card-body">
        <div className="pd-analyst-grid">
          <div className="pd-read">
            <span className="pd-kicker mono">LOCAL READ · DETERMINISTIC</span>
            {localReadSentences(profile, metrics, linked).map((line) => (
              <p key={line}>{line}</p>
            ))}
            <ul>
              <li>
                <ShieldCheck size={11} /> {metrics.teams.length} teams own {profile.mitigations.length} controls
                {profile.mitigations[0] ? `; start with "${profile.mitigations[0].control}" (${profile.mitigations[0].team})` : ''}.
              </li>
              <li>
                <Crosshair size={11} /> {profile.indicators.length} hunt indicators: {profile.indicators.slice(0, 3).join(' · ')}.
              </li>
            </ul>
            <p className="pd-source">
              Event counts are seeded demo telemetry and ATT&amp;CK is a trimmed offline subset. A profile is a planning
              artefact, not an attribution.
            </p>
            <button
              type="button"
              className="pd-shortcut"
              onClick={() => {
                const prompt = 'Fix the weakest stage in this profile. Give me the exact control, owner and evidence to check.'
                setInput(prompt)
                inputRef.current?.focus()
              }}
            >
              Draft the weakest-stage question <ArrowRight size={12} />
            </button>
          </div>

          <div className="pd-chat">
            <div className="pd-thread" ref={threadRef} aria-live="polite">
              {thread.length === 0 && (
                <div className="pd-prompts">
                  <p>Ask about this profile. Answers use the evidence above and the current estate, never invented data.</p>
                  <div>
                    {PROMPTS.map((prompt) => (
                      <button key={prompt} type="button" onClick={() => void ask(prompt)}>
                        {prompt}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {thread.map((message, i) => (
                <div className={cx('pd-msg', message.role)} key={`${message.role}-${i}`}>
                  {message.role === 'assistant' ? (
                    message.content ? (
                      <AiMarkdown text={message.content} />
                    ) : (
                      <span className="pd-typing">
                        <i />
                        <i />
                        <i />
                      </span>
                    )
                  ) : (
                    <p>{message.content}</p>
                  )}
                </div>
              ))}
              {error && (
                <div className="pd-error" role="alert">
                  <AlertTriangle size={13} />
                  <span>{error}</span>
                  <button type="button" onClick={() => void ask(lastPrompt.current)}>
                    <RefreshCw size={11} /> Retry
                  </button>
                </div>
              )}
            </div>

            <form
              className="pd-form"
              onSubmit={(event) => {
                event.preventDefault()
                void ask(input)
              }}
            >
              <textarea
                ref={inputRef}
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault()
                    void ask(input)
                  }
                }}
                rows={1}
                placeholder={`Ask about ${profile.name}…`}
                aria-label={`Ask the analyst about ${profile.name}`}
              />
              {streaming ? (
                <button type="button" className="pd-send stop" onClick={stop} aria-label="Stop the answer">
                  <X size={13} /> Stop
                </button>
              ) : (
                <button type="submit" className="pd-send" disabled={!input.trim()} aria-label="Ask the analyst">
                  <ArrowRight size={13} /> Ask
                </button>
              )}
            </form>
            <p className="pd-chat-note">Streams from the workspace copilot. It can recommend actions but cannot change data.</p>
          </div>
        </div>
      </div>
    </section>
  )
}

function localReadSentences(profile: AttackProfile, metrics: ProfileMetrics, linked: Technique[]) {
  const start = profile.stages[0]
  const end = profile.stages[profile.stages.length - 1]
  const unmapped = metrics.stageRows.filter((s) => s.techniques.length === 0)
  const weakest =
    unmapped[unmapped.length - 1] ?? [...metrics.stageRows].sort((a, b) => a.events - b.events)[0] ?? null
  const linkedNames = linked
    .slice()
    .sort((a, b) => b.observed - a.observed)
    .slice(0, 2)
    .map((t) => `${t.id} ${t.name}`)
    .join(' and ')
  const lines = [
    `${profile.name} is a ${profile.stages.length}-stage ${profile.category.toLowerCase()} chain: it starts with ${start?.tactic?.toLowerCase() ?? 'entry'} and ends at ${end?.tactic?.toLowerCase() ?? 'impact'}.`,
    `${metrics.linkedCount < profile.techniques.length ? `${metrics.linkedCount} of ${profile.techniques.length} declared techniques are` : `All ${metrics.linkedCount} techniques are`} in the trimmed subset and contribute ${metrics.observedTotal.toLocaleString('en-US')} observed demo events — the ${metrics.eventsRank} profile here (rank ${metrics.rank} of ${attackProfiles.length}).`,
    `${metrics.mappedStages} of ${profile.stages.length} stages carry a mapped technique (${metrics.stageCoverage}%).`,
  ]
  if (linkedNames) lines.push(`Most of the signal comes from ${linkedNames}.`)
  if (weakest) {
    lines.push(
      weakest.techniques.length
        ? `The thinnest link is ${weakest.tactic} with ${weakest.events.toLocaleString('en-US')} events; confirm telemetry there before trusting coverage.`
        : `${weakest.tactic} has no mapped technique in the trimmed subset — treat that as an evidence gap, not a confirmed blind spot.`,
    )
  }
  return lines
}

function localProfileAnswer(
  question: string,
  profile: AttackProfile,
  metrics: ProfileMetrics,
  linked: Technique[],
) {
  const q = question.toLowerCase()
  const teams = metrics.teams.map((t) => t.name).join(', ')
  const ranked = [...linked].sort((a, b) => b.observed - a.observed)
  const top = ranked[0]
  const unmapped = metrics.stageRows.filter((s) => s.techniques.length === 0)
  const weakest =
    unmapped[unmapped.length - 1] ?? [...metrics.stageRows].sort((a, b) => a.events - b.events)[0] ?? null
  const heaviest = attackProfiles
    .map((p) => ({
      name: p.name,
      events: p.techniques
        .map((id) => techniques.find((t) => t.id === id))
        .filter(Boolean)
        .reduce((sum, t) => sum + (t as Technique).observed, 0),
    }))
    .sort((a, b) => b.events - a.events)[0]
  const control = profile.mitigations[0]
  const lines: string[] = ['**Local read** — the copilot service is not configured here, so this answer is assembled from the profile evidence.']

  if (q.includes('compare') || q.includes('estate')) {
    lines.push(
      `**Where it sits.** ${profile.name} contributes **${metrics.observedTotal.toLocaleString('en-US')}** linked events, ranked **${metrics.rank} of ${attackProfiles.length}** (${metrics.eventsRank}). ${
        heaviest?.name === profile.name
          ? 'This is the heaviest profile in the demo estate.'
          : `The heaviest is **${heaviest?.name}** at ${heaviest?.events.toLocaleString('en-US')} events.`
      }`,
      `**Coverage.** ${metrics.mappedStages} of ${profile.stages.length} stages carry a mapped technique (${metrics.stageCoverage}%), and ${profile.mitigations.length} controls are split across ${teams}.`,
    )
  } else if (q.includes('control') || q.includes('gap') || q.includes('fix') || q.includes('weakest')) {
    lines.push(
      weakest
        ? `**Thinnest link.** ${weakest.tactic}${weakest.techniques.length ? ` carries ${weakest.events.toLocaleString('en-US')} events across ${weakest.techniques.length} technique${weakest.techniques.length === 1 ? '' : 's'}` : ' has no mapped technique in the trimmed subset'} — confirm telemetry there before trusting coverage.`
        : '**Thinnest link.** Every stage carries a mapped technique, so the gap is detection quality rather than coverage.',
      control
        ? `**First control.** ${control.control} — owner **${control.team}**. Close the loop by checking the evidence this profile lists: ${profile.indicators[0] ?? 'the hunt indicators'}.`
        : '**First control.** No control is recorded for this profile, so the owning team is unassigned.',
      `**Then.** ${profile.mitigations.slice(1).map((m) => `${m.control} (${m.team})`).join('; ') || 'No further controls are recorded.'}`,
    )
  } else if (q.includes('next') || q.includes('actor') || q.includes('try')) {
    const mapped = metrics.stageRows.filter((s) => s.techniques.length).map((s) => s.tactic)
    lines.push(
      '**A profile cannot predict intent.** It can show the shape of the chain and the places to watch.',
      `**Where it moves.** The stages are ${profile.stages.map((s) => s.tactic).join(' → ')}. Evidence is mapped at ${mapped.length ? mapped.join(' → ') : 'no stage in the trimmed subset'}.`,
      `**Watch for.** ${profile.indicators.join(' · ')}. These are detection hypotheses, not sightings.`,
    )
  } else {
    lines.push(
      `**In plain terms.** ${profile.name} is a ${profile.stages.length}-stage ${profile.category.toLowerCase()} chain that runs ${profile.stages.map((s) => s.tactic).join(' → ')}.`,
      `**Evidence.** ${top ? `${top.id} ${top.name} carries the most linked signal (${top.observed.toLocaleString('en-US')} events); the profile totals ${metrics.observedTotal.toLocaleString('en-US')} events across ${metrics.linkedCount} technique${metrics.linkedCount === 1 ? '' : 's'}.` : 'No linked technique carries observed events in the trimmed subset.'}`,
      weakest?.techniques.length
        ? `**Gap.** ${weakest.tactic} is the thinnest stage at ${weakest.events.toLocaleString('en-US')} events.`
        : weakest
          ? `**Gap.** ${weakest.tactic} has no mapped technique — an evidence gap, not a proven blind spot.`
          : '',
      control
        ? `**First move.** ${control.control} with **${control.team}**, then verify with ${profile.indicators[0] ?? 'the hunt indicators'}.`
        : '',
    )
  }

  lines.push(
    '**Data note.** Event counts are seeded demo telemetry, ATT&CK is a trimmed offline subset, and a profile is a planning artefact rather than an attribution.',
  )
  return lines.filter(Boolean).join('\n\n')
}
