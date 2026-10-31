import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { AnalystMark } from '../components/AnalystMark'
import { AiMarkdown } from '../components/AiMarkdown'
import {
  Activity,
  ArrowRight,
  Database,
  Gauge,
  Info,
  RefreshCw,
  Sparkles,
  X,
} from '../components/Icons'
import { useAiPanel } from '../lib/aiStore'
import { useAuth } from '../lib/store'
import { counts, posture } from '../data/seed'
import { componentByPath } from './catalog'
import { cx } from '../lib/format'

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

export function AiTrigger() {
  const open = useAiPanel((s) => s.open)
  const openWith = useAiPanel((s) => s.openWith)
  return (
    <button
      type="button"
      className={cx('ai-trigger', open && 'active')}
      onClick={() => openWith()}
      aria-label="Open Aegis Copilot"
      title="Ask Aegis Copilot (Ctrl/⌘ + I)"
    >
      <AnalystMark size={19} live={open} />
      <span className="ai-trigger-label">Ask Aegis</span>
      <kbd className="ai-trigger-kbd">⌘I</kbd>
    </button>
  )
}

export default function AiDock() {
  const location = useLocation()
  const session = useAuth((s) => s.session)
  const open = useAiPanel((s) => s.open)
  const prompt = useAiPanel((s) => s.prompt)
  const openWith = useAiPanel((s) => s.openWith)
  const close = useAiPanel((s) => s.close)
  const clearPrompt = useAiPanel((s) => s.clearPrompt)
  const messages = useAiPanel((s) => s.messages)
  const streaming = useAiPanel((s) => s.streaming)
  const error = useAiPanel((s) => s.chatError)
  const send = useAiPanel((s) => s.send)
  const stop = useAiPanel((s) => s.stop)
  const resetChat = useAiPanel((s) => s.resetChat)
  const retryChat = useAiPanel((s) => s.retryChat)

  const component = componentByPath(location.pathname)
  const [input, setInput] = useState('')

  const view = { pathname: location.pathname, role: session?.role, name: session?.name }
  const viewRef = useRef(view)
  viewRef.current = view

  const handledNonce = useRef(0)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (!open || !prompt) return
    if (handledNonce.current === prompt.nonce) return
    handledNonce.current = prompt.nonce
    const queued = prompt.text
    clearPrompt()
    send(queued, viewRef.current)
  }, [open, prompt, clearPrompt, send])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'i') {
        e.preventDefault()
        if (open) close()
        else openWith()
      }
      if (e.key === 'Escape' && open) close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, close, openWith])

  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const t = window.setTimeout(() => inputRef.current?.focus(), 280)
    return () => {
      document.body.style.overflow = prev
      window.clearTimeout(t)
    }
  }, [open])

  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(132, el.scrollHeight)}px`
  }, [input, open])

  const lastContent = messages[messages.length - 1]?.content ?? ''
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 180
    if (nearBottom) el.scrollTo({ top: el.scrollHeight, behavior: 'auto' })
  }, [messages.length, lastContent, streaming, open])

  const hasMessages = messages.length > 0

  return (
    <>
      <div className={cx('ai-scrim', open && 'open')} onClick={close} aria-hidden="true" />
      <aside
        className={cx('ai-drawer', open && 'open')}
        role="dialog"
        aria-modal="true"
        aria-label="Aegis Copilot"
        aria-hidden={!open}
      >
        <div className="ai-drawer-aura" aria-hidden="true" />
        <header className="ai-drawer-head">
          <div className="ai-drawer-id">
            <AnalystMark size={36} live={streaming} />
            <div>
              <div className="ai-drawer-title">
                Aegis Copilot <span className="ai-chip">AI</span>
              </div>
              <div className="ai-drawer-sub">
                <i className={cx('ai-status-dot', streaming && 'busy')} />
                {streaming ? 'Thinking it through…' : 'Online · workspace + general knowledge'}
              </div>
            </div>
          </div>
          <div className="ai-drawer-actions">
            {hasMessages && (
              <button type="button" className="ai-icon-btn" onClick={resetChat} title="New chat" aria-label="New chat">
                <RefreshCw size={14} />
              </button>
            )}
            <button type="button" className="ai-icon-btn" onClick={close} title="Close copilot" aria-label="Close copilot">
              <X size={15} />
            </button>
          </div>
        </header>

        <div className="ai-context-bar">
          <span className="ai-context-page">
            <Sparkles size={10} />
            {component.name}
          </span>
          <span className="ai-context-stat">
            {counts.active} alerts · posture {posture}
          </span>
        </div>

        <div className="ai-thread" ref={scrollRef}>
          {!hasMessages && (
            <div className="ai-empty">
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
                source health behind this page. When I use live demo data, I cite the same numbers on screen.
              </p>
              <div className="ai-suggestions">
                {SUGGESTIONS.map((s) => {
                  const Icon = s.icon
                  return (
                    <button
                      key={s.title}
                      type="button"
                      className="ai-suggestion"
                      onClick={() => send(s.prompt, view)}
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
                      <span>{component.name}</span>
                      <span>·</span>
                      <span>{session?.role === 'ADMIN' ? 'admin' : 'analyst'} session</span>
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
          className="ai-composer"
          onSubmit={(e) => {
            e.preventDefault()
            send(input, view)
            setInput('')
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
                  send(input, view)
                  setInput('')
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
      </aside>
    </>
  )
}
