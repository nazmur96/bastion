import { useSyncExternalStore } from 'react'
import {
  STEP_OUTPUT_LIMIT,
  isLongRunning,
  type StepState,
  type StepsEvent
} from '../../../../shared/fork-devops-steps'

/** Fork: recent step-by-step runs (newest first), fed by main-process events. */
export type StepsRun = {
  runId: string
  title: string
  steps: { id: string; command: string; state: StepState; output: string }[]
  finished: boolean
  ok: boolean
}

const MAX_RUNS = 6
let runs: StepsRun[] = []
const afterSuccess = new Map<string, () => void>()
const listeners = new Set<() => void>()
let subscribed = false

function publish(next: StepsRun[]): void {
  runs = next
  listeners.forEach((listener) => listener())
}

function onEvent(event: StepsEvent): void {
  const next = runs.map((run) => {
    if (run.runId !== event.runId) {
      return run
    }
    if (event.kind === 'finished') {
      if (event.ok) {
        afterSuccess.get(run.runId)?.()
      }
      afterSuccess.delete(run.runId)
      return { ...run, finished: true, ok: event.ok }
    }
    const steps = run.steps.map((step, index) => {
      if (index !== event.index) {
        return step
      }
      return event.kind === 'step'
        ? { ...step, state: event.state }
        : { ...step, output: (step.output + event.text).slice(-STEP_OUTPUT_LIMIT) }
    })
    return { ...run, steps }
  })
  publish(next)
}

/**
 * Runs the finite steps one by one; a trailing long-running step (a port-forward, a shell)
 * goes to `thenInTerminal` once the rest succeeded, since it is meant to keep running.
 */
export function startSteps(input: {
  title: string
  workspacePath: string
  steps: string[]
  env?: Record<string, string>
  thenInTerminal?: (command: string) => void
  onSuccess?: () => void
}): void {
  if (!subscribed) {
    subscribed = true
    window.api.aiVault.onStepsEvent(onEvent)
  }
  const tail = input.steps.at(-1)
  const longTail = tail !== undefined && isLongRunning(tail) ? tail : null
  const finite = longTail ? input.steps.slice(0, -1) : input.steps
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  afterSuccess.set(runId, () => {
    if (longTail) {
      input.thenInTerminal?.(longTail)
    }
    input.onSuccess?.()
  })
  publish(
    [
      {
        runId,
        title: input.title,
        steps: finite.map((command, index) => ({
          id: `${runId}-${index}`,
          command,
          state: 'waiting' as const,
          output: ''
        })),
        finished: false,
        ok: false
      },
      ...runs
    ].slice(0, MAX_RUNS)
  )
  void window.api.aiVault.runSteps({
    runId,
    workspacePath: input.workspacePath,
    steps: finite,
    env: input.env
  })
}

export function cancelRun(runId: string): void {
  void window.api.aiVault.cancelSteps(runId)
}

export function dismissRun(runId: string): void {
  publish(runs.filter((run) => run.runId !== runId))
}

export function useStepsRuns(): StepsRun[] {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => runs
  )
}
