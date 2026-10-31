import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type Stage = 'triage' | 'assess' | 'contain' | 'remediate' | 'verify'
export type Priority = 'P1' | 'P2' | 'P3' | 'P4'

export const STAGES: { key: Stage; label: string; caption: string }[] = [
  { key: 'triage', label: 'Triage', caption: 'Validate exposure and ownership' },
  { key: 'assess', label: 'Assess', caption: 'Confirm versions and blast radius' },
  { key: 'contain', label: 'Contain', caption: 'Isolate or mitigate at-risk hosts' },
  { key: 'remediate', label: 'Remediate', caption: 'Deploy the fix, restart services' },
  { key: 'verify', label: 'Verify', caption: 'Re-scan versions, close alerts' },
]

export const PRIORITIES: Priority[] = ['P1', 'P2', 'P3', 'P4']

export const SLA_DAYS: Record<Priority, number> = { P1: 1, P2: 3, P3: 7, P4: 14 }

export const stageIndex = (stage: Stage) => STAGES.findIndex((entry) => entry.key === stage)

export const stageLabel = (stage: Stage) => STAGES[stageIndex(stage)]?.label ?? stage

export const OWNERS = ['Platform', 'Network', 'Identity', 'IT Ops', 'Security']

export type LogKind = 'stage' | 'owner' | 'priority' | 'check' | 'note' | 'incident'

export interface CveLogEntry {
  id: string
  at: string
  kind: LogKind
  text: string
}

export interface CveFlow {
  stage: Stage
  owner: string | null
  priority: Priority
  checks: string[]
  startedAt: string | null
  incidentId: string | null
  log: CveLogEntry[]
}

interface WorkflowStore {
  flows: Record<string, CveFlow>
  setStage: (cveId: string, stage: Stage, priority: Priority) => void
  setOwner: (cveId: string, owner: string | null, priority: Priority) => void
  setPriority: (cveId: string, priority: Priority) => void
  toggleCheck: (cveId: string, checkId: string, label: string, priority: Priority) => void
  addNote: (cveId: string, text: string, priority: Priority) => void
  raiseIncident: (cveId: string, priority: Priority) => string
  reset: (cveId: string) => void
}

const blank = (priority: Priority = 'P3'): CveFlow => ({
  stage: 'triage',
  owner: null,
  priority,
  checks: [],
  startedAt: null,
  incidentId: null,
  log: [],
})

const entry = (kind: LogKind, text: string): CveLogEntry => ({
  id: crypto.randomUUID(),
  at: new Date().toISOString(),
  kind,
  text,
})

const started = (priority: Priority): CveFlow => ({
  ...blank(priority),
  startedAt: new Date().toISOString(),
  log: [entry('stage', `Response workflow started · ${priority}`)],
})

export const useCveWorkflow = create<WorkflowStore>()(
  persist(
    (set, get) => ({
      flows: {},
      setStage: (cveId, stage, priority) =>
        set((state) => {
          const existing = state.flows[cveId]
          const flow = existing ?? started(priority)
          if (existing && existing.stage === stage) return state
          const log = existing ? [...flow.log, entry('stage', `Stage → ${stageLabel(stage)}`)] : flow.log
          return {
            flows: {
              ...state.flows,
              [cveId]: { ...flow, stage, log },
            },
          }
        }),
      setOwner: (cveId, owner, priority) =>
        set((state) => {
          const existing = state.flows[cveId]
          const flow = existing ?? started(priority)
          if (existing && existing.owner === owner) return state
          const log = existing
            ? [...flow.log, entry('owner', owner ? `Owner → ${owner}` : 'Owner cleared')]
            : flow.log
          return {
            flows: {
              ...state.flows,
              [cveId]: { ...flow, owner, log },
            },
          }
        }),
      setPriority: (cveId, priority) =>
        set((state) => {
          const existing = state.flows[cveId]
          const flow = existing ?? started(priority)
          if (existing && existing.priority === priority) return state
          const log = existing ? [...flow.log, entry('priority', `Priority → ${priority}`)] : flow.log
          return {
            flows: {
              ...state.flows,
              [cveId]: { ...flow, priority, log },
            },
          }
        }),
      toggleCheck: (cveId, checkId, label, priority) =>
        set((state) => {
          const flow = state.flows[cveId] ?? started(priority)
          const done = flow.checks.includes(checkId)
          return {
            flows: {
              ...state.flows,
              [cveId]: {
                ...flow,
                checks: done ? flow.checks.filter((id) => id !== checkId) : [...flow.checks, checkId],
                log: [...flow.log, entry('check', `${done ? 'Reopened' : 'Completed'} · ${label}`)],
              },
            },
          }
        }),
      addNote: (cveId, text, priority) =>
        set((state) => {
          const note = text.trim()
          if (!note) return state
          const flow = state.flows[cveId] ?? started(priority)
          return {
            flows: { ...state.flows, [cveId]: { ...flow, log: [...flow.log, entry('note', note)] } },
          }
        }),
      raiseIncident: (cveId, priority) => {
        const existing = get().flows[cveId]?.incidentId
        if (existing) return existing
        const incidentId = `INC-${new Date().getFullYear()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`
        set((state) => {
          const flow = state.flows[cveId] ?? started(priority)
          const log = [...flow.log, entry('incident', `Incident ${incidentId} opened`)]
          if (flow.stage !== 'contain') log.push(entry('stage', 'Stage → Contain'))
          return {
            flows: {
              ...state.flows,
              [cveId]: { ...flow, incidentId, stage: 'contain', log },
            },
          }
        })
        return incidentId
      },
      reset: (cveId) =>
        set((state) => {
          const flows = { ...state.flows }
          delete flows[cveId]
          return { flows }
        }),
    }),
    { name: 'aegis.cve-workflows', version: 1 },
  ),
)
