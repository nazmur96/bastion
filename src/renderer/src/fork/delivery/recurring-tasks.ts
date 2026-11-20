import { useSyncExternalStore } from 'react'
import { z } from 'zod'
import {
  RECURRING_MAX_TASKS,
  recurringTaskSchema,
  type RecurringTask
} from '../../../../shared/fork-delivery/recurring-contract'

/**
 * Fork: Step 14.5 recurring task definitions, per project and per client, beside the Delivery
 * configuration they are built from. Each task holds a complete, validated request snapshot.
 */
const key = (projectId: string) => `bastion.recurring.${projectId}`
const listeners = new Set<() => void>()
const cache = new Map<string, RecurringTask[]>()
const EMPTY: RecurringTask[] = []

export function loadRecurringTasks(projectId: string): RecurringTask[] {
  const cached = cache.get(projectId)
  if (cached) {
    return cached
  }
  let tasks: RecurringTask[] = EMPTY
  try {
    const parsed = z
      .array(recurringTaskSchema)
      .max(RECURRING_MAX_TASKS)
      .safeParse(JSON.parse(localStorage.getItem(key(projectId)) ?? '[]'))
    tasks = parsed.success ? parsed.data : EMPTY
  } catch {
    tasks = EMPTY
  }
  cache.set(projectId, tasks)
  return tasks
}
export function saveRecurringTasks(projectId: string, tasks: RecurringTask[]): void {
  const valid = z.array(recurringTaskSchema).max(RECURRING_MAX_TASKS).parse(tasks)
  cache.set(projectId, valid)
  try {
    localStorage.setItem(key(projectId), JSON.stringify(valid))
  } catch {
    // Storage unavailable: the tasks still run for this session.
  }
  for (const listener of listeners) {
    listener()
  }
}
function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
export function useRecurringTasks(projectId: string | null): RecurringTask[] {
  return useSyncExternalStore(subscribe, () => (projectId ? loadRecurringTasks(projectId) : EMPTY))
}

/** Live runner state shared with the Delivery page: what is running and the last owner error. */
export type RunnerState = { running: string | null; error: string | null; revision: number }
let state: RunnerState = { running: null, error: null, revision: 0 }
const stateListeners = new Set<() => void>()
export function setRunnerState(next: Partial<RunnerState>): void {
  state = { ...state, ...next }
  for (const listener of stateListeners) {
    listener()
  }
}
export function useRunnerState(): RunnerState {
  return useSyncExternalStore(
    (listener) => {
      stateListeners.add(listener)
      return () => stateListeners.delete(listener)
    },
    () => state
  )
}
