import { useSyncExternalStore } from 'react'

const KEY = 'orca-fork.pathColumn.collapsed.v1'
const DESKTOP_KEY = 'orca-fork.pathColumn.desktop.v1'
let desktopInitialized = false

function load(): boolean {
  try {
    return localStorage.getItem(KEY) === 'true'
  } catch {
    return false
  }
}

let collapsed = load()
const listeners = new Set<() => void>()

export function initializeDesktopPathColumn(): void {
  if (desktopInitialized) {
    return
  }
  desktopInitialized = true
  try {
    if (localStorage.getItem(DESKTOP_KEY) === '1') {
      return
    }
    localStorage.setItem(DESKTOP_KEY, '1')
  } catch {
    // Keep the initial desktop uncluttered even when storage is unavailable.
  }
  setPathColumnCollapsed(true)
}

/** Fold the Project path column to a thin strip, or open it again. */
export function togglePathColumn(): void {
  setPathColumnCollapsed(!collapsed)
}

export function isPathColumnCollapsed(): boolean {
  return collapsed
}

export function setPathColumnCollapsed(next: boolean): void {
  if (collapsed === next) {
    return
  }
  collapsed = next
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
