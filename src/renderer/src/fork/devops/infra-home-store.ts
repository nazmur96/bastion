import { useSyncExternalStore } from 'react'

const STORAGE_KEY = 'orca-fork.infraHome.v2'

/** What the Project path opens over the middle of the workbench, beside chat and files. */
export type InfraView = 'map' | 'tools'

type InfraHomeState = {
  /** The view each workspace shows over its workbench right now, if any. */
  view: Record<string, InfraView>
  /** Workspaces whose first open already set up the layout. */
  seen: Record<string, boolean>
}

function isView(value: unknown): value is InfraView {
  return value === 'map' || value === 'tools'
}

function load(): InfraHomeState {
  try {
    const parsed: unknown = JSON.parse(globalThis.localStorage?.getItem(STORAGE_KEY) ?? '{}')
    if (parsed && typeof parsed === 'object') {
      const view: unknown = Reflect.get(parsed, 'view')
      const seen: unknown = Reflect.get(parsed, 'seen')
      return {
        view:
          view && typeof view === 'object'
            ? Object.fromEntries(
                Object.entries(view).filter((entry): entry is [string, InfraView] =>
                  isView(entry[1])
                )
              )
            : {},
        seen: seen && typeof seen === 'object' ? Object.fromEntries(Object.entries(seen)) : {}
      }
    }
  } catch {
    // A blocked or corrupt store only loses which views were open.
  }
  return { view: {}, seen: {} }
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

export function setInfraView(worktreeId: string, view: InfraView | null): void {
  if ((state.view[worktreeId] ?? null) === view) {
    return
  }
  const next = { ...state.view }
  if (view) {
    next[worktreeId] = view
  } else {
    delete next[worktreeId]
  }
  update({ ...state, view: next })
}

export function useInfraView(worktreeId: string): InfraView | null {
  const read = (): InfraView | null => state.view[worktreeId] ?? null
  return useSyncExternalStore(subscribe, read, read)
}

// Where the open view draws: the workbench body registers itself, the path column portals into it.
const targets = new Map<string, HTMLElement>()
const targetListeners = new Set<() => void>()

export function setInfraOverlayTarget(worktreeId: string, element: HTMLElement | null): void {
  if (element) {
    targets.set(worktreeId, element)
  } else {
    targets.delete(worktreeId)
  }
  for (const listener of targetListeners) {
    listener()
  }
}

export function useInfraOverlayTarget(worktreeId: string): HTMLElement | null {
  return useSyncExternalStore(
    (listener) => {
      targetListeners.add(listener)
      return () => targetListeners.delete(listener)
    },
    () => targets.get(worktreeId) ?? null,
    () => null
  )
}
