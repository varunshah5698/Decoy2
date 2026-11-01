import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Copy } from 'lucide-react'
import { AnalystMark } from '../../components/AnalystMark'
import { AiMarkdown } from '../../components/AiMarkdown'
import {
  Activity,
  ArrowRight,
  Check,
  ChevronDown,
  Database,
  Gauge,
  Info,
  RefreshCw,
  Sparkles,
} from '../../components/Icons'
import { componentByPath } from '../../app/catalog'
import { useEstate } from '../../lib/estate'
import { mlPortfolio, MODEL_CARD } from '../../lib/ml'
import { useAiPanel } from '../../lib/aiStore'
import { useAuth } from '../../lib/store'
import { cx } from '../../lib/format'

const SUGGESTIONS = [
  {
    title: 'What can you do?',
    detail: 'General questions plus workspace answers',
    prompt: 'Hi! What can you do?',
    icon: Sparkles,
  },
  {
    title: 'What is happening now?',
    detail: 'Situation summary for the demo org',
    prompt: 'What is happening right now? Give me the bottom line, what matters and what to do next.',
    icon: Activity,
  },
  {
    title: 'What should I patch first?',
    detail: 'Score, exposure and XGBoost probability',
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

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<number | undefined>(undefined)

  useEffect(() => () => window.clearTimeout(timer.current), [])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      const area = document.createElement('textarea')
      area.value = text
      area.style.position = 'fixed'
      area.style.opacity = '0'
      document.body.appendChild(area)
      area.select()
      document.execCommand('copy')
      area.remove()
    }
    setCopied(true)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setCopied(false), 1600)
  }

  return (
    <button
      type="button"
      className={cx('ai-copy', copied && 'copied')}
      onClick={copy}
      aria-label={copied ? 'Response copied' : 'Copy response'}
      title={copied ? 'Copied' : 'Copy response'}
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
      <span>{copied ? 'Copied' : 'Copy'}</span>
    </button>
  )
}

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
  const estate = useEstate()
  const { assets, counts, posture, sourceHealth } = estate
  const uploadDatasets = estate.datasets
  const uploadedAssets = estate.uploadedAssets
  const portfolio = mlPortfolio(estate.activeAlerts)
  const degradedCount = sourceHealth.filter((s) => s.status === 'DEGRADED').length

  const component = componentByPath('/app/ai')
  const [input, setInput] = useState('')
  const [pinned, setPinned] = useState(true)
  const viewRef = useRef({ pathname: location.pathname, role: session?.role, name: session?.name })
  viewRef.current = { pathname: location.pathname, role: session?.role, name: session?.name }

  const threadRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const handledNonce = useRef<number | null>(null)

  const lastContent = messages[messages.length - 1]?.content ?? ''
  useEffect(() => {
    if (!messages.length) return
    const el = threadRef.current
    if (!el || !pinned) return
    el.scrollTop = el.scrollHeight
  }, [messages.length, lastContent, streaming]) // eslint-disable-line react-hooks/exhaustive-deps

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

  const scrollToLatest = () => {
    setPinned(true)
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: 'smooth' })
  }

  const onThreadScroll = () => {
    const el = threadRef.current
    if (!el) return
    setPinned(el.scrollHeight - el.scrollTop - el.clientHeight < 96)
  }

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
          <AnalystMark size={50} live={streaming} />
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
        <section className={cx('ai-page-chat', streaming && 'is-streaming')} aria-label="Aegis Copilot chat">
          <span className="ai-page-progress" aria-hidden="true" />

          <div className="ai-context-bar ai-page-context">
            <span className="ai-context-page">
              <Sparkles size={10} />
              {component.name}
            </span>
            <span className="ai-context-stat">
              {counts.active} alerts · posture {posture} · {roleLabel.toLowerCase()} session
            </span>
          </div>

          <div className="ai-thread ai-page-thread" ref={threadRef} onScroll={onThreadScroll}>
            <div className="ai-stream">
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
                  <div className="ai-suggestions ai-suggestion-grid">
                    {SUGGESTIONS.map((s, idx) => {
                      const Icon = s.icon
                      return (
                        <button
                          key={s.title}
                          type="button"
                          className="ai-suggestion"
                          style={{ '--i': idx } as CSSProperties}
                          onClick={() => send(s.prompt, viewRef.current)}
                        >
                          <span className="ai-suggestion-icon">
                            <Icon size={15} />
                          </span>
                          <span className="ai-suggestion-copy">
                            <strong>{s.title}</strong>
                            <span>{s.detail}</span>
                          </span>
                          <span className="ai-suggestion-arrow" aria-hidden="true">
                            <ArrowRight size={13} />
                          </span>
                        </button>
                      )
                    })}
                  </div>
                  <div className="ai-empty-hint">
                    <Sparkles size={11} />
                    <span>
                      Tip — press <kbd>Ctrl</kbd> / <kbd>⌘</kbd> + <kbd>I</kbd> anywhere to jump back here.
                    </span>
                  </div>
                </div>
              )}

              {messages.map((m, i) => {
                const isLast = i === messages.length - 1
                const isStreamingMsg = streaming && isLast

                if (m.role === 'user') {
                  return (
                    <div className="ai-msg user" key={i}>
                      <div className="ai-bubble">{m.content}</div>
                    </div>
                  )
                }

                if (!m.content) {
                  if (!streaming || !isLast) return null
                  return (
                    <div className="ai-msg assistant" key={i}>
                      <div className="ai-msg-gutter">
                        <AnalystMark size={28} live />
                      </div>
                      <div className="ai-msg-body">
                        <div className="ai-msg-head">
                          <span className="ai-msg-name">Aegis Copilot</span>
                          <span className="ai-msg-tag">Live</span>
                        </div>
                        <div className="ai-msg-card">
                          <div className="ai-thinking">
                            <span />
                            <span />
                            <span />
                            <em>Thinking…</em>
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                }

                return (
                  <div className={cx('ai-msg', 'assistant', isStreamingMsg && 'is-streaming')} key={i}>
                    <div className="ai-msg-gutter">
                      <AnalystMark size={28} live={isStreamingMsg} />
                    </div>
                    <div className="ai-msg-body">
                      <div className="ai-msg-head">
                        <span className="ai-msg-name">Aegis Copilot</span>
                        <span className="ai-msg-tag">Live</span>
                        <span className="ai-msg-session">{roleLabel} session</span>
                        {!isStreamingMsg && <CopyButton text={m.content} />}
                      </div>
                      <div className="ai-msg-card">
                        <AiMarkdown text={m.content} />
                        {isStreamingMsg && <span className="ai-caret" aria-hidden="true" />}
                      </div>
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

              {hasMessages && (
                <button
                  type="button"
                  className={cx('ai-scroll-btn', !pinned && 'show')}
                  onClick={scrollToLatest}
                  aria-label="Scroll to latest message"
                  aria-hidden={pinned}
                  tabIndex={pinned ? -1 : 0}
                  title="Scroll to latest"
                >
                  <ChevronDown size={15} />
                </button>
              )}
            </div>
          </div>

          <form
            className="ai-composer ai-page-composer"
            onSubmit={(e) => {
              e.preventDefault()
              submit()
            }}
          >
            <div className="ai-composer-inner">
              <div className="ai-input-wrap">
                <Sparkles size={13} className="ai-input-spark" aria-hidden="true" />
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
                  <button
                    type="button"
                    className="ai-send stop"
                    onClick={stop}
                    aria-label="Stop response"
                    title="Stop"
                  >
                    <span className="ai-stop-square" />
                  </button>
                ) : (
                  <button
                    type="submit"
                    className="ai-send"
                    disabled={!input.trim()}
                    aria-label="Send message"
                    title="Send"
                  >
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
            </div>
          </form>
        </section>

        <aside className="ai-page-rail" aria-label="Copilot context">
          <div className="ai-page-card" style={{ '--i': 0 } as CSSProperties}>
            <span className="ai-page-card-kicker">
              <Activity size={11} /> Live context
            </span>
            <h3>What I can see</h3>

            <div className="ai-posture">
              <div className="ai-posture-top">
                <span>Posture</span>
                <strong>
                  {posture}
                  <em>/100</em>
                </strong>
              </div>
              <div
                className="ai-posture-track"
                role="img"
                aria-label={`Posture ${posture} of 100`}
              >
                <span style={{ '--p': `${posture}%` } as CSSProperties} />
              </div>
            </div>

            <div className="ai-page-facts">
              <div className="ai-page-fact">
                <span>Active alerts</span>
                <strong>
                  {counts.active}
                  <em className="ai-fact-crit"> · {counts.critical} critical</em>
                </strong>
              </div>
              <div className="ai-page-fact">
                <span>Inventory</span>
                <strong>
                  {assets.length} assets
                  {uploadedAssets.length > 0 && <span className="dim"> · {uploadedAssets.length} uploaded</span>}
                </strong>
              </div>
              <div className="ai-page-fact">
                <span>Sources</span>
                <strong>{sourceHealth.length} · {degradedCount} degraded</strong>
              </div>
              {uploadDatasets.length > 0 && (
                <div className="ai-page-fact">
                  <span>Scope</span>
                  <strong>{estate.scope.all ? `${uploadDatasets.length} accepted` : estate.scope.label.slice(0, 22)}</strong>
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
              Answers about the workspace use these live demo numbers. {portfolio.elevated} of{' '}
              {portfolio.coverage} active alerts carry an elevated XGBoost prior; the deterministic score stays
              authoritative.
            </p>
          </div>

          <div className="ai-page-card" style={{ '--i': 1 } as CSSProperties}>
            <span className="ai-page-card-kicker">
              <Sparkles size={11} /> Jump in
            </span>
            <h3>Quick prompts</h3>
            <div className="ai-page-quick">
              {QUICK_PROMPTS.map((prompt) => (
                <button key={prompt} type="button" onClick={() => send(prompt, viewRef.current)}>
                  <span>{prompt}</span>
                  <ArrowRight size={12} aria-hidden="true" />
                </button>
              ))}
            </div>
          </div>

          <div className="ai-page-card" style={{ '--i': 2 } as CSSProperties}>
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
