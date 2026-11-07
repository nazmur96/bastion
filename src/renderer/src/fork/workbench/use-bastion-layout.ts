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
import { setSideSection, syncSideSection, type SideSection } from './side-panel-store'

const SECTION_FOR_TAB: Partial<Record<string, SideSection>> = {
  explorer: 'files',
  'source-control': 'changes',
  checks: 'checks'
}

let busy = false
let lastTab: string | null = null

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
        // Orca's right sidebar is never drawn in a workspace; its state stays "open" so its
        // panels keep loading where the side panel draws them, and a shortcut that picks one of
        // its tabs picks the side panel's section.
        const ui = useAppStore.getState()
        if (!ui.rightSidebarOpen) {
          ui.setRightSidebarOpen(true)
        }
        if (ui.rightSidebarTab !== lastTab) {
          lastTab = ui.rightSidebarTab
          const section = SECTION_FOR_TAB[ui.rightSidebarTab]
          if (section) {
            setSideSection(worktreeId, section)
          }
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
    lastTab = null
    syncSideSection(worktreeId)
    run()
    return useAppStore.subscribe(run)
  }, [worktreeId])
}
