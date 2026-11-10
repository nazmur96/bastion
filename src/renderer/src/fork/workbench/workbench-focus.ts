import { useSyncExternalStore } from 'react'
import { useAppStore } from '@/store'
import { isPathColumnCollapsed, setPathColumnCollapsed } from '../devops/path-column-store'
import { liveTerminalDockId, readTerminalDockSplit, setTerminalDockShare } from './terminal-dock'
import { readSideSection, setSideSection } from './side-panel-store'
import {
  loadFocusSnapshot,
  saveFocusSnapshot,
  type WorkbenchFocusTarget
} from './workbench-focus-snapshot'

export type { WorkbenchFocusTarget } from './workbench-focus-snapshot'

let session = loadFocusSnapshot()
let needsRecovery = session !== null
const listeners = new Set<() => void>()

function publish(): void {
  for (const listener of listeners) {
    listener()
  }
}

export function readWorkbenchFocus(worktreeId: string): WorkbenchFocusTarget | null {
  return session?.worktreeId === worktreeId ? session.target : null
}

export function restoreWorkbenchLayout(worktreeId: string): void {
  if (!session || session.worktreeId !== worktreeId) {
    return
  }
  const before = session
  session = null
  needsRecovery = false
  saveFocusSnapshot(null)
  const dockId = liveTerminalDockId(worktreeId)
  if (dockId === before.dockId || dockId === null) {
    setTerminalDockShare(worktreeId, before.share)
  }
  useAppStore.getState().setSidebarOpen(before.sidebarOpen)
  setPathColumnCollapsed(before.pathCollapsed)
  setSideSection(worktreeId, before.section)
  publish()
}

export function recoverWorkbenchLayout(): void {
  if (needsRecovery && session && useAppStore.getState().workspaceSessionReady) {
    restoreWorkbenchLayout(session.worktreeId)
  }
}

export function focusWorkbenchSurface(worktreeId: string, target: WorkbenchFocusTarget): void {
  const ui = useAppStore.getState()
  if (ui.activeWorktreeId !== worktreeId) {
    return
  }
  if (session && session.worktreeId !== worktreeId) {
    restoreWorkbenchLayout(session.worktreeId)
  }
  const dockId = liveTerminalDockId(worktreeId)
  const split = readTerminalDockSplit(worktreeId)
  if (!dockId || !split) {
    return
  }
  session = session
    ? { ...session, target }
    : {
        worktreeId,
        target,
        dockId,
        share: split.workbenchShare,
        sidebarOpen: useAppStore.getState().sidebarOpen,
        pathCollapsed: isPathColumnCollapsed(),
        section: readSideSection(worktreeId)
      }
  saveFocusSnapshot(session)
  useAppStore.getState().setSidebarOpen(false)
  setPathColumnCollapsed(true)
  setTerminalDockShare(worktreeId, target === 'terminal' ? 0 : 1, false)
  if (target === 'terminal') {
    setSideSection(worktreeId, 'terminal')
  }
  publish()
}

export function toggleWorkbenchFocus(worktreeId: string, target: WorkbenchFocusTarget): void {
  if (readWorkbenchFocus(worktreeId) === target) {
    restoreWorkbenchLayout(worktreeId)
  } else {
    focusWorkbenchSurface(worktreeId, target)
  }
}

export function useWorkbenchFocus(worktreeId: string): WorkbenchFocusTarget | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => readWorkbenchFocus(worktreeId),
    () => null
  )
}
