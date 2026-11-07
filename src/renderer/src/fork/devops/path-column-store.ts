import { useSyncExternalStore } from 'react'

const KEY = 'orca-fork.pathColumn.collapsed.v1'

function load(): boolean {
  try {
    return localStorage.getItem(KEY) === 'true'
  } catch {
    return false
  }
}

let collapsed = load()
const listeners = new Set<() => void>()

/** Fold the Project path column to a thin strip, or open it again. */
export function togglePathColumn(): void {
  collapsed = !collapsed
  try {
    localStorage.setItem(KEY, String(collapsed))
  } catch {
    // Without storage the column opens again next start.
  }
  for (const listener of listeners) {
    listener()
  }
}

export function usePathColumnCollapsed(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => collapsed,
    () => false
  )
}
