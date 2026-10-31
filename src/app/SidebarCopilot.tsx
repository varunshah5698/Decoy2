import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { AnalystMark } from '../components/AnalystMark'
import { AiMarkdown } from '../components/AiMarkdown'
import { ArrowRight, ExternalLink, Sparkles } from '../components/Icons'
import { useAiPanel } from '../lib/aiStore'
import { useAuth } from '../lib/store'
import { cx } from '../lib/format'

export default function SidebarCopilot() {
  const location = useLocation()
  const session = useAuth((s) => s.session)
  const messages = useAiPanel((s) => s.messages)
  const streaming = useAiPanel((s) => s.streaming)
  const send = useAiPanel((s) => s.send)
  const openWith = useAiPanel((s) => s.openWith)

  const [input, setInput] = useState('')
  const threadRef = useRef<HTMLDivElement>(null)
  const view = { pathname: location.pathname, role: session?.role, name: session?.name }
  const viewRef = useRef(view)
  viewRef.current = view

  const lastContent = messages[messages.length - 1]?.content ?? ''
  useEffect(() => {
    const el = threadRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages.length, lastContent, streaming])

  const submit = () => {
    if (!input.trim()) return
    send(input, viewRef.current)
    setInput('')
  }

  const visible = messages.slice(-4)

  return (
    <section className="side-copilot" aria-label="Aegis Copilot">
      <header className="side-copilot-head">
        <AnalystMark size={24} live={streaming} />
        <div className="side-copilot-id">
          <strong>Aegis Copilot</strong>
          <span>
            <i className={cx('ai-status-dot', streaming && 'busy')} />
            {streaming ? 'Thinking…' : 'General + workspace'}
          </span>
        </div>
        <button
          type="button"
          className="side-copilot-expand"
          onClick={() => openWith()}
          title="Open full chat"
          aria-label="Open full chat"
        >
          <ExternalLink size={12} />
        </button>
      </header>

      <div className="side-copilot-thread" ref={threadRef}>
        {visible.length === 0 ? (
          <div className="side-copilot-hello">
            <p>Hi. Ask me anything — this workspace, security concepts, code or everyday questions.</p>
            <div className="side-copilot-chips">
              <button type="button" onClick={() => send('hi', viewRef.current)}>
                Say hi
              </button>
              <button
                type="button"
                onClick={() =>
                  send('What is happening right now? Bottom line, what matters, what to do next.', viewRef.current)
                }
              >
                Situation now
              </button>
            </div>
          </div>
        ) : (
          visible.map((m, i) => (
            <div key={i} className={cx('side-copilot-msg', m.role)}>
              {m.role === 'assistant' && <AnalystMark size={16} live={streaming && i === visible.length - 1} />}
              <div className="side-copilot-bubble">
                {m.role === 'assistant' ? <AiMarkdown text={m.content || 'Thinking…'} /> : m.content}
                {m.role === 'assistant' && streaming && i === visible.length - 1 && m.content && (
                  <span className="ai-caret" aria-hidden="true" />
                )}
              </div>
            </div>
          ))
        )}
      </div>

      <form
        className="side-copilot-form"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <span className="side-copilot-spark" aria-hidden="true">
          <Sparkles size={12} />
        </span>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Say hi or ask anything…"
          aria-label="Ask Aegis Copilot"
        />
        <button type="submit" disabled={!input.trim()} aria-label="Send to copilot">
          <ArrowRight size={13} />
        </button>
      </form>
    </section>
  )
}
