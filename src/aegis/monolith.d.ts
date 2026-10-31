export interface MonolithReadout {
  code: string
  detail: string
  score: number
  suppressed: boolean
  /** Six weighted score inputs, each normalised to 0..1. */
  bands?: number[]
}

export interface MonolithOptions {
  reducedMotion?: boolean
  readouts?: MonolithReadout[]
}

export interface MonolithHandle {
  ok: boolean
  dispose: () => void
}

export function mountAegisMonolith(canvas: HTMLCanvasElement, options?: MonolithOptions): MonolithHandle
