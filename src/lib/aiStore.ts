import { create } from 'zustand'
import { buildAnalystContext, localBriefing, streamAnalyst, type ChatMessage } from './ai'
import { localChatReply, type ChatView } from './chat'
import { counts, posture } from '../data/seed'
import { useAuth } from './store'
import { useUploads } from './uploads'

const BRIEFING_REQUEST = `Write today's situation briefing for the dashboard. Use the attached context only.`

export interface BriefingState {
  key: string
  text: string
  status: 'streaming' | 'done' | 'fallback'
  note?: string
}

export interface ChatErrorState {
  message: string
  prompt: string
  view: ChatView
}

interface AiState {
  briefing: BriefingState | null
  messages: ChatMessage[]
  streaming: boolean
  chatError: ChatErrorState | null
  generateBriefing: (pathname?: string, force?: boolean) => void
  send: (text: string, view: ChatView) => void
  stop: () => void
  resetChat: () => void
  retryChat: () => void
}

let activeBriefing: AbortController | null = null
let chatController: AbortController | null = null
let queuedChat: { text: string; view: ChatView } | null = null

const briefingKey = (pathname: string) =>
  `briefing:${pathname}:${posture}:${counts.active}:${counts.critical}:${useUploads.getState().datasets.length}`

const withoutEmptyTail = (messages: ChatMessage[]) => {
  const next = messages.slice()
  const last = next[next.length - 1]
  if (last?.role === 'assistant' && !last.content) next.pop()
  return next
}

const currentViewer = () => {
  const session = useAuth.getState().session
  return { role: session?.role, name: session?.name }
}

export const useAiPanel = create<AiState>((set, get) => ({
  briefing: null,
  messages: [],
  streaming: false,
  chatError: null,

  generateBriefing: (pathname = '/app', force = false) => {
    const key = briefingKey(pathname)
    const current = get().briefing
    if (!force && current?.key === key) return

    activeBriefing?.abort()
    const controller = new AbortController()
    activeBriefing = controller

    const context = buildAnalystContext(pathname, currentViewer())
    let acc = ''

    set({ briefing: { key, text: '', status: 'streaming' } })

    streamAnalyst({
      messages: [{ role: 'user', content: BRIEFING_REQUEST }],
      context,
      mode: 'briefing',
      signal: controller.signal,
      onDelta: (delta) => {
        if (activeBriefing !== controller) return
        acc += delta
        set((s) => (s.briefing?.key === key ? { briefing: { ...s.briefing, text: acc, status: 'streaming' } } : s))
      },
    })
      .then((text) => {
        if (activeBriefing !== controller) return
        const final = (text || acc).trim()
        set({
          briefing: {
            key,
            text: final || localBriefing(context),
            status: final ? 'done' : 'fallback',
            note: final ? undefined : 'The copilot returned nothing, so a local summary is shown.',
          },
        })
      })
      .catch((err: any) => {
        if (activeBriefing !== controller) return
        if (err?.name === 'AbortError' && !acc.trim()) return
        set({
          briefing: {
            key,
            text: acc.trim() || localBriefing(context),
            status: acc.trim() ? 'done' : 'fallback',
            note: acc.trim()
              ? undefined
              : `${err?.message ?? 'The copilot is unavailable.'} Showing local analysis instead.`,
          },
        })
      })
  },

  send: (raw, view) => {
    const text = raw.trim()
    if (!text) return

    if (get().streaming) {
      queuedChat = { text, view }
      return
    }

    set({ chatError: null })

    const local = localChatReply(text, view)
    if (local) {
      set((s) => ({
        messages: [...s.messages, { role: 'user', content: text }, { role: 'assistant', content: local }],
      }))
      return
    }

    const history = [...get().messages, { role: 'user' as const, content: text }].slice(-14)
    set({
      messages: [...history, { role: 'assistant', content: '' }],
      streaming: true,
    })

    const controller = new AbortController()
    chatController = controller
    let acc = ''

    streamAnalyst({
      messages: history,
      context: buildAnalystContext(view.pathname, { role: view.role, name: view.name }),
      signal: controller.signal,
      onDelta: (delta) => {
        if (chatController !== controller) return
        acc += delta
        set((s) => {
          if (!s.messages.length) return s
          const next = s.messages.slice()
          next[next.length - 1] = { role: 'assistant', content: acc }
          return { messages: next }
        })
      },
    })
      .then((full) => {
        if (chatController !== controller) return
        const final = (full || acc).trim()
        if (!final) {
          set((s) => ({
            messages: withoutEmptyTail(s.messages),
            chatError: { message: 'The copilot returned an empty response. Try again.', prompt: text, view },
          }))
        }
      })
      .catch((err: any) => {
        if (chatController !== controller) return
        if (err?.name === 'AbortError') {
          set((s) => ({ messages: withoutEmptyTail(s.messages) }))
          return
        }
        set((s) => ({
          messages: withoutEmptyTail(s.messages),
          chatError: {
            message: err?.message ?? 'Something went wrong. Try again.',
            prompt: text,
            view,
          },
        }))
      })
      .finally(() => {
        if (chatController !== controller) return
        chatController = null
        set({ streaming: false })
        const queued = queuedChat
        queuedChat = null
        if (queued) window.setTimeout(() => get().send(queued.text, queued.view), 40)
      })
  },

  stop: () => {
    queuedChat = null
    const controller = chatController
    chatController = null
    controller?.abort()
    set((s) => ({ messages: withoutEmptyTail(s.messages), streaming: false }))
  },

  resetChat: () => {
    queuedChat = null
    chatController?.abort()
    chatController = null
    set({ messages: [], streaming: false, chatError: null })
  },

  retryChat: () => {
    const error = get().chatError
    if (!error) return
    set({ chatError: null })
    get().send(error.prompt, error.view)
  },
}))
