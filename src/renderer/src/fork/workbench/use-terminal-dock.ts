import { useEffect } from 'react'
import { useAppStore } from '@/store'
import {
  ensureTerminalDock,
  liveTerminalDockId,
  sizeEvenTerminalDock,
  sizeTerminalDock
} from './terminal-dock'
import { workbenchGroupId } from './workbench-terminals'

let moving = false

/** Terminals opened in the workbench (its +, the CLI, a shortcut) move down into the dock. */
function moveTerminalsToDock(worktreeId: string, workbenchId: string): void {
  if (moving) {
    return
  }
  const state = useAppStore.getState()
  const tabs = state.unifiedTabsByWorktree[worktreeId] ?? []
  const strays = tabs.filter((tab) => tab.groupId === workbenchId && tab.contentType === 'terminal')
  if (strays.length === 0) {
    return
  }
  moving = true
  try {
    const dock = ensureTerminalDock(worktreeId, workbenchId)
    if (!dock) {
      return
    }
    for (const tab of strays) {
      useAppStore.getState().moveUnifiedTabToGroup(tab.id, dock, { activate: true })
    }
  } finally {
    moving = false
  }
}

export function useTerminalsInDock(worktreeId: string, workbenchId: string | null): void {
  useEffect(() => {
    if (!workbenchId || liveTerminalDockId(worktreeId) === workbenchId) {
      return
    }
    const move = (): void => moveTerminalsToDock(worktreeId, workbenchId)
    move()
    return useAppStore.subscribe(move)
  }, [worktreeId, workbenchId])
}

/** Orca prunes a group its last tab left, a beat after the move: whenever the dock is all that
 *  is left beside the Claude panel, an empty workbench goes back above it for the path. */
export function useWorkbenchAboveDock(worktreeId: string, dockId: string | null): void {
  useEffect(() => {
    if (!dockId) {
      return
    }
    const heal = (): void => {
      if (moving || workbenchGroupId(worktreeId) !== null) {
        return
      }
      moving = true
      try {
        useAppStore
          .getState()
          .createEmptySplitGroup(worktreeId, dockId, 'left', { activate: false })
        sizeTerminalDock(worktreeId, dockId)
      } finally {
        moving = false
      }
    }
    heal()
    sizeEvenTerminalDock(worktreeId, dockId)
    return useAppStore.subscribe(heal)
  }, [worktreeId, dockId])
}

/** The side panel holds only terminals: a file, page or chat opened while it had focus moves to
 *  the middle, where the person reads and edits it. */
export function useOnlyTerminalsInDock(worktreeId: string, dockId: string | null): void {
  useEffect(() => {
    if (!dockId) {
      return
    }
    const sweep = (): void => {
      if (moving) {
        return
      }
      const state = useAppStore.getState()
      const strays = (state.unifiedTabsByWorktree[worktreeId] ?? []).filter(
        (tab) => tab.groupId === dockId && tab.contentType !== 'terminal'
      )
      const workbench = workbenchGroupId(worktreeId)
      if (strays.length === 0 || !workbench) {
        return
      }
      moving = true
      try {
        for (const tab of strays) {
          useAppStore.getState().moveUnifiedTabToGroup(tab.id, workbench, { activate: true })
        }
        useAppStore.getState().focusGroup(worktreeId, workbench)
      } finally {
        moving = false
      }
    }
    sweep()
    return useAppStore.subscribe(sweep)
  }, [worktreeId, dockId])
}
