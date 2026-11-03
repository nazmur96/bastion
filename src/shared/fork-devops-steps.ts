/** Fork: a multi-step run shown step by step instead of as one opaque terminal line. */
export type StepState = 'waiting' | 'running' | 'done' | 'failed' | 'cancelled'

export type StepsEvent =
  | { runId: string; kind: 'step'; index: number; state: StepState }
  | { runId: string; kind: 'output'; index: number; text: string }
  | { runId: string; kind: 'finished'; ok: boolean }

export type StepsRequest = {
  runId: string
  workspacePath: string
  /** Each a full command line (already wrapped for the repo's mise when needed). */
  steps: string[]
  env?: Record<string, string>
}

export const STEP_OUTPUT_LIMIT = 200_000

/** Steps that never finish on their own (port-forwards, shells) belong in a terminal, not here. */
export function isLongRunning(step: string): boolean {
  return /\bport-forward\b|\bmultipass shell\b|\bkubectl\b.*\s-f\b.*--follow|\blogs\b.*\s-f\b/.test(
    step
  )
}
