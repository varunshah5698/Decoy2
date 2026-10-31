import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { AnalystMark } from '../../components/AnalystMark'
import { AiMarkdown } from '../../components/AiMarkdown'
import {
  Activity,
  ArrowRight,
  Database,
  Gauge,
  Info,
  RefreshCw,
  Sparkles,
} from '../../components/Icons'
import { componentByPath } from '../../app/catalog'
import { assets, counts, posture, sourceHealth } from '../../data/seed'
import { mlPortfolio, MODEL_CARD } from '../../lib/ml'
import { useAiPanel } from '../../lib/aiStore'
import { useAuth } from '../../lib/store'
import { allUploadedAssets, useUploads } from '../../lib/uploads'
import { cx } from '../../lib/format'

const SUGGESTIONS = [
  {
    title: 'Hi — what can you do?',
    detail: 'General questions plus workspace answers',
    prompt: 'Hi! What can you do?',
    icon: Sparkles,
  },
  {
    title: 'What is happening right now?',
    detail: 'Situation summary across the demo organisation',
    prompt: 'What is happening right now? Give me the bottom line, what matters and what to do next.',
    icon: Activity,
  },
  {
    title: 'What should I patch first?',
    detail: 'Ranked by score, exposure and XGBoost probability',
    prompt: 'What should I patch first? Rank the assets by score, exposure and the XGBoost probability.',
    icon: Gauge,
  },
  {
    title: 'Explain EPSS vs CVSS',
    detail: 'A general answer, no dashboard needed',
    prompt: 'Explain EPSS vs CVSS and when each one matters. Keep it practical and concise.',
    icon: Database,
  },
]

const QUICK_PROMPTS = [
  'Summarise the top three risks with evidence.',
  'Walk me through the deterministic scoring formula.',
  'Where is the data incomplete or simulated?',
]

type PromptState = { prompt?: string; nonce?: number } | null

export default function AiAnalyst() {
  const location = useLocation()
  const navigate = useNavigate()
  const session = useAuth((s) => s.session)
  const messages = useAiPanel((s) => s.messages)
  const streaming = useAiPanel((s) => s.streaming)
  const error = useAiPanel((s) => s.chatError)
  const send = useAiPanel((s) => s.send)
  const stop = useAiPanel((s) => s.stop)
  const resetChat = useAiPanel((s) => s.resetChat)
  const retryChat = useAiPanel((s) => s.retryChat)
  const uploadDatasets = useUploads((s) => s.datasets)

  const uploadedAssets = allUploadedAssets(uploadDatasets)

  const component = componentByPath('/app/ai')
  const [input, setInput] = useState('')
  const viewRef = useRef({ pathname: location.pathname, role: session?.role, name: session?.name })
  viewRef.current = { pathname: location.pathname, role: session?.role, name: session?.name }

  const threadRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const handledNonce = useRef<number | null>(null)

  const lastContent = messages[messages.length - 1]?.content ?? ''
  useEffect(() => {
    const el = threadRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages.length, lastContent, streaming])

  useEffect(() => {
    inputRef.current?.focus()
    const focus = () => inputRef.current?.focus()
    window.addEventListener('aegis-ai-focus', focus)
    return () => window.removeEventListener('aegis-ai-focus', focus)
  }, [])

  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(160, el.scrollHeight)}px`
  }, [input])

  const navState = location.state as PromptState
  useEffect(() => {
    const prompt = navState?.prompt
    if (!prompt) return
    const nonce = navState?.nonce ?? 0
    if (handledNonce.current === nonce) return
    handledNonce.current = nonce
    send(prompt, viewRef.current)
    navigate(location.pathname, { replace: true, state: null })
  }, [navState, send, navigate, location.pathname])

  const submit = () => {
    if (!input.trim()) return
    send(input, viewRef.current)
    setInput('')
  }

  const hasMessages = messages.length > 0
  const roleLabel = session?.role === 'ADMIN' ? 'Admin' : 'Analyst'

  return (
    <div className="page ai-page">
      <header className="ai-page-head">
        <div className="ai-page-id">
          <AnalystMark size={48} live={streaming} />
          <div>
            <span className="ai-kicker">ASSISTANT · WORKSPACE + GENERAL</span>
            <h1>Aegis Copilot</h1>
            <p>
              Ask anything — this workspace or the wider world. Workspace answers cite the same demo numbers on
              screen; general questions get a normal chatbot.
            </p>
          </div>
        </div>
        <div className="ai-page-actions">
          <span className={cx('ai-brief-status', streaming && 'busy')}>
            <i className="ai-status-dot" />
            {streaming ? 'Thinking…' : 'Online'}
          </span>
          <button
            type="button"
            className="ai-icon-btn"
            onClick={resetChat}
            disabled={!hasMessages || streaming}
            title="New chat"
            aria-label="Start a new chat"
          >
            <RefreshCw size={14} />
          </button>
        </div>
      </header>

      <div className="ai-page-grid">
        <section className="ai-page-chat" aria-label="Aegis Copilot chat">
          <div className="ai-context-bar ai-page-context">
            <span className="ai-context-page">
              <Sparkles size={10} />
              {component.name}
            </span>
            <span className="ai-context-stat">
              {counts.active} alerts · posture {posture} · {roleLabel.toLowerCase()} session
            </span>
          </div>

          <div className="ai-thread ai-page-thread" ref={threadRef}>
            {!hasMessages && (
              <div className="ai-empty ai-empty-center">
                <div className="ai-empty-mark">
                  <AnalystMark size={58} live />
                </div>
                <span className="ai-kicker">GENERAL + WORKSPACE</span>
                <h2>
                  Ask anything.
                  <br />
                  <em>Get the evidence.</em>
                </h2>
                <p>
                  I can answer general questions like any chatbot, or dig into the alerts, assets, scores and
                  source health behind this workspace. When I use live demo data, I cite the same numbers on
                  screen.
                </p>
                <div className="ai-suggestions">
                  {SUGGESTIONS.map((s) => {
                    const Icon = s.icon
                    return (
                      <button
                        key={s.title}
                        type="button"
                        className="ai-suggestion"
                        onClick={() => send(s.prompt, viewRef.current)}
                      >
                        <span className="ai-suggestion-icon">
                          <Icon size={14} />
                        </span>
                        <span className="ai-suggestion-copy">
                          <strong>{s.title}</strong>
                          <span>{s.detail}</span>
                        </span>
                        <ArrowRight size={13} />
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            {messages.map((m, i) => {
              if (m.role === 'user') {
                return (
                  <div className="ai-msg user" key={i}>
                    <div className="ai-bubble">{m.content}</div>
                  </div>
                )
              }
              if (!m.content) {
                if (!streaming || i !== messages.length - 1) return null
                return (
                  <div className="ai-msg assistant" key={i}>
                    <AnalystMark size={26} live />
                    <div className="ai-thinking">
                      <span />
                      <span />
                      <span />
                      <em>Thinking…</em>
                    </div>
                  </div>
                )
              }
              return (
                <div className="ai-msg assistant" key={i}>
                  <AnalystMark size={26} live={streaming && i === messages.length - 1} />
                  <div className="ai-msg-body">
                    <AiMarkdown text={m.content} />
                    {!(streaming && i === messages.length - 1) && (
                      <div className="ai-msg-meta">
                        <span>Aegis Copilot</span>
                        <span>·</span>
                        <span>{roleLabel.toLowerCase()} session</span>
                      </div>
                    )}
                  </div>
                </div>
              )
            })}

            {error && (
              <div className="ai-error" role="alert">
                <Info size={15} />
                <div>
                  <strong>Copilot unavailable</strong>
                  <p>{error.message}</p>
                </div>
                <button type="button" className="ai-retry" onClick={retryChat}>
                  Retry
                </button>
              </div>
            )}
          </div>

          <form
            className="ai-composer ai-page-composer"
            onSubmit={(e) => {
              e.preventDefault()
              submit()
            }}
          >
            <div className="ai-input-wrap">
              <textarea
                ref={inputRef}
                rows={1}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    submit()
                  }
                }}
                placeholder="Ask anything — workspace or general…"
                aria-label="Message Aegis Copilot"
              />
              {streaming ? (
                <button type="button" className="ai-send stop" onClick={stop} aria-label="Stop response" title="Stop">
                  <span className="ai-stop-square" />
                </button>
              ) : (
                <button type="submit" className="ai-send" disabled={!input.trim()} aria-label="Send message" title="Send">
                  <ArrowRight size={16} />
                </button>
              )}
            </div>
            <div className="ai-composer-meta">
              <span>
                <kbd>Enter</kbd> send · <kbd>Shift</kbd>+<kbd>Enter</kbd> newline
              </span>
              <span>Demo workspace · general knowledge</span>
            </div>
          </form>
        </section>

        <aside className="ai-page-rail" aria-label="Copilot context">
          <div className="ai-page-card">
            <span className="ai-page-card-kicker">
              <Activity size={11} /> Live context
            </span>
            <h3>What I can see</h3>
            <div className="ai-page-facts">
              <div className="ai-page-fact">
                <span>Posture</span>
                <strong>{posture}/100</strong>
              </div>
              <div className="ai-page-fact">
                <span>Active alerts</span>
                <strong>
                  {counts.active} · {counts.critical} critical
                </strong>
              </div>
              <div className="ai-page-fact">
                <span>Inventory</span>
                <strong>
                  {assets.length + uploadedAssets.length} assets
                  {uploadedAssets.length > 0 && <span className="dim"> · {uploadedAssets.length} uploaded</span>}
                </strong>
              </div>
              <div className="ai-page-fact">
                <span>Sources</span>
                <strong>{sourceHealth.length} · 1 degraded</strong>
              </div>
              {uploadDatasets.length > 0 && (
                <div className="ai-page-fact">
                  <span>Uploads</span>
                  <strong>{uploadDatasets.length} accepted</strong>
                </div>
              )}
              <div className="ai-page-fact">
                <span>XGBoost</span>
                <strong>
                  v{MODEL_CARD.version} · AUC {MODEL_CARD.test.auc.toFixed(3)}
                </strong>
              </div>
              <div className="ai-page-fact">
                <span>Session</span>
                <strong>{roleLabel}</strong>
              </div>
            </div>
            <p className="ai-page-note">
              Answers about the workspace use these live demo numbers. {mlPortfolio.elevated} of{' '}
              {mlPortfolio.coverage} active alerts carry an elevated XGBoost prior; the deterministic score stays
              authoritative.
            </p>
          </div>

          <div className="ai-page-card">
            <span className="ai-page-card-kicker">
              <Sparkles size={11} /> Jump in
            </span>
            <h3>Quick prompts</h3>
            <div className="ai-page-quick">
              {QUICK_PROMPTS.map((prompt) => (
                <button key={prompt} type="button" onClick={() => send(prompt, viewRef.current)}>
                  {prompt}
                </button>
              ))}
            </div>
          </div>

          <div className="ai-page-card">
            <span className="ai-page-card-kicker">
              <Database size={11} /> How it answers
            </span>
            <h3>Scope and honesty</h3>
            <p className="ai-page-note">
              <strong>Workspace:</strong> alerts, assets, CVEs, scoring, provenance, anomalies and source health.
            </p>
            <p className="ai-page-note">
              <strong>General:</strong> security concepts, code, writing, maths and everyday questions.
            </p>
            <p className="ai-page-note">
              <strong>Demo data:</strong> telemetry is simulated. NVD, CISA KEV and FIRST EPSS identifiers are real
              public records.
            </p>
            {session?.role !== 'ADMIN' && (
              <p className="ai-page-note">
                <strong>Analyst access:</strong> data uploads, the what-if simulator and bulk export remain
                admin-only.
              </p>
            )}
          </div>
        </aside>
      </div>
    </div>
  )
}
