import { useEffect } from 'react'
import { useAppStore } from '@/store'
import {
  isClaudePanelHidden,
  readClaudePanelGroupId,
  setClaudePanelGroupId,
  setClaudePanelHidden
} from '../claude-panel/claude-panel-registry'
import { ensureTerminalDock, liveTerminalDockId } from './terminal-dock'
import { workbenchGroupId } from './workbench-terminals'

let busy = false

/** Bastion's layout has no separate Claude column: chat is the first tab in the middle, beside
 *  the files and pages it opens. A workspace saved with the column gets its chats moved over. */
function foldClaudePanel(worktreeId: string): void {
  if (!isClaudePanelHidden()) {
    setClaudePanelHidden(true)
  }
  const panel = readClaudePanelGroupId(worktreeId)
  if (!panel) {
    return
  }
  const state = useAppStore.getState()
  const groups = state.groupsByWorktree[worktreeId] ?? []
  setClaudePanelGroupId(worktreeId, null)
  const dock = liveTerminalDockId(worktreeId)
  const target = groups.find((group) => group.id !== panel && group.id !== dock)
  if (!groups.some((group) => group.id === panel) || !target) {
    // Gone already, or the only group: then it simply is the middle.
    return
  }
  const chats = (state.unifiedTabsByWorktree[worktreeId] ?? []).filter(
    (tab) => tab.groupId === panel
  )
  chats.forEach((tab, index) => {
    useAppStore
      .getState()
      .moveUnifiedTabToGroup(tab.id, target.id, { index, activate: index === 0 })
  })
}

export function useBastionLayout(worktreeId: string): void {
  useEffect(() => {
    const run = (): void => {
      if (busy) {
        return
      }
      busy = true
      try {
        foldClaudePanel(worktreeId)
        if (useAppStore.getState().rightSidebarOpen) {
          // Orca restores its right sidebar after a workspace opens; the side panel replaces it.
          useAppStore.getState().setRightSidebarOpen(false)
        }
        // The side panel (files, changes, terminal, browser, checks) is always there.
        const workbench = workbenchGroupId(worktreeId)
        if (workbench) {
          ensureTerminalDock(worktreeId, workbench)
        }
      } finally {
        busy = false
      }
    }
    run()
    return useAppStore.subscribe(run)
  }, [worktreeId])
}
