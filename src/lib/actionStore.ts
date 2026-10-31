import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ActionStatus } from './warnings'

export interface ActionNote {
  by: string
  at: string
  text: string
}

export interface ActionEntry {
  status: ActionStatus
  owner?: string
  notes: ActionNote[]
  updatedAt: string
  verifiedAt?: string
  verifiedBy?: string
  verifiedNote?: string
  evidenceKey?: string
}

interface ActionState {
  entries: Record<string, ActionEntry>
  setStatus: (id: string, status: Exclude<ActionStatus, 'VERIFIED'>, by: string, note?: string) => void
  assign: (id: string, owner: string, by: string) => void
  addNote: (id: string, by: string, text: string) => void
  verify: (id: string, by: string, note: string, evidenceKey: string) => void
  reopen: (id: string, by: string, why: string) => void
  reset: () => void
}

const nowIso = () => new Date().toISOString()

const seedEntries: Record<string, ActionEntry> = {
  'rec-ALR-1011-PATCH': {
    status: 'IN_PROGRESS',
    owner: 'Platform Engineering',
    notes: [
      { by: 'Dev Sharma', at: '2026-10-30T15:20:00Z', text: 'Browser fleet update scheduled for tonight.' },
    ],
    updatedAt: '2026-10-30T15:20:00Z',
  },
  'rec-ALR-1009-PATCH': {
    status: 'COMPLETED',
    owner: 'HR Platforms',
    notes: [
      { by: 'Meera Iyer', at: '2026-10-29T11:05:00Z', text: 'Upgrade applied to the HR portal build.' },
    ],
    updatedAt: '2026-10-30T08:40:00Z',
  },
}

const ensure = (entries: Record<string, ActionEntry>, id: string): ActionEntry =>
  entries[id] ?? { status: 'NEW', notes: [], updatedAt: nowIso() }

export const useActions = create<ActionState>()(
  persist(
    (set) => ({
      entries: seedEntries,
      setStatus: (id, status, by, note) =>
        set((s) => {
          const current = ensure(s.entries, id)
          const notes = note
            ? [...current.notes, { by, at: nowIso(), text: note }]
            : current.notes
          return {
            entries: {
              ...s.entries,
              [id]: { ...current, status, notes, updatedAt: nowIso() },
            },
          }
        }),
      assign: (id, owner, by) =>
        set((s) => {
          const current = ensure(s.entries, id)
          return {
            entries: {
              ...s.entries,
              [id]: {
                ...current,
                owner,
                notes: [...current.notes, { by, at: nowIso(), text: `Assigned to ${owner}.` }],
                updatedAt: nowIso(),
              },
            },
          }
        }),
      addNote: (id, by, text) =>
        set((s) => {
          const current = ensure(s.entries, id)
          return {
            entries: {
              ...s.entries,
              [id]: {
                ...current,
                notes: [...current.notes, { by, at: nowIso(), text }],
                updatedAt: nowIso(),
              },
            },
          }
        }),
      verify: (id, by, note, evidenceKey) =>
        set((s) => {
          const current = ensure(s.entries, id)
          const at = nowIso()
          return {
            entries: {
              ...s.entries,
              [id]: {
                ...current,
                status: 'VERIFIED',
                verifiedAt: at,
                verifiedBy: by,
                verifiedNote: note,
                evidenceKey,
                notes: [...current.notes, { by, at, text: `Verified: ${note}` }],
                updatedAt: at,
              },
            },
          }
        }),
      reopen: (id, by, why) =>
        set((s) => {
          const current = ensure(s.entries, id)
          return {
            entries: {
              ...s.entries,
              [id]: {
                ...current,
                status: 'NEW',
                verifiedAt: undefined,
                verifiedBy: undefined,
                verifiedNote: undefined,
                evidenceKey: undefined,
                notes: [...current.notes, { by, at: nowIso(), text: `Reopened: ${why}` }],
                updatedAt: nowIso(),
              },
            },
          }
        }),
      reset: () => set({ entries: seedEntries }),
    }),
    { name: 'aegis.actions' },
  ),
)

export const entryStatus = (entries: Record<string, ActionEntry>, id: string): ActionStatus =>
  entries[id]?.status ?? 'NEW'

export const actionsForAlert = (entries: Record<string, ActionEntry>, alertId: string) =>
  Object.keys(entries).filter((id) => id.startsWith(`rec-${alertId}-`))

export const openActionCount = (
  recommendations: { id: string }[],
  entries: Record<string, ActionEntry>,
) => recommendations.filter((r) => entryStatus(entries, r.id) !== 'VERIFIED').length
