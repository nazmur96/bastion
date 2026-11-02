import { useSyncExternalStore } from 'react'

const STORAGE_KEY = 'orca-fork.infraHome.v1'

type InfraHomeState = {
  /** Workspaces whose workbench shows the Infra home right now. */
  open: Record<string, boolean>
  /** Workspaces that already got their first automatic Infra home. */
  seen: Record<string, boolean>
}

function load(): InfraHomeState {
  try {
    const parsed: unknown = JSON.parse(globalThis.localStorage?.getItem(STORAGE_KEY) ?? '{}')
    if (parsed && typeof parsed === 'object') {
      const open: unknown = Reflect.get(parsed, 'open')
      const seen: unknown = Reflect.get(parsed, 'seen')
      return {
        open: open && typeof open === 'object' ? Object.fromEntries(Object.entries(open)) : {},
        seen: seen && typeof seen === 'object' ? Object.fromEntries(Object.entries(seen)) : {}
      }
    }
  } catch {
    // A blocked or corrupt store only loses which homes were open.
  }
  return { open: {}, seen: {} }
}

let state = load()
const listeners = new Set<() => void>()

function update(next: InfraHomeState): void {
  state = next
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // Persistence is a convenience.
  }
  for (const listener of listeners) {
    listener()
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function setInfraHomeOpen(worktreeId: string, open: boolean): void {
  if (Boolean(state.open[worktreeId]) !== open) {
    update({ ...state, open: { ...state.open, [worktreeId]: open } })
  }
}

/** The first time a DevOps workspace is seen, its workbench starts on the Infra home. */
export function openInfraHomeOnce(worktreeId: string): void {
  if (!state.seen[worktreeId]) {
    update({
      open: { ...state.open, [worktreeId]: true },
      seen: { ...state.seen, [worktreeId]: true }
    })
  }
}

export function useInfraHomeOpen(worktreeId: string): boolean {
  const read = (): boolean => Boolean(state.open[worktreeId])
  return useSyncExternalStore(subscribe, read, read)
}
