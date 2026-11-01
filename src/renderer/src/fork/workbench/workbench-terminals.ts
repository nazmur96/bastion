import { useAppStore } from '@/store'
import { focusTerminalTabSurface } from '@/lib/focus-terminal-tab-surface'
import { readClaudePanelGroupId } from '../claude-panel/claude-panel-registry'
import { pickNonPanelGroupId } from '../claude-panel/claude-panel-layout'
import { latestTabInSection } from './workbench-sections'

/** The workbench column: not the Claude panel and not a chats-only group (a side chat). */
export function workbenchGroupId(worktreeId: string): string | null {
  const state = useAppStore.getState()
  const groups = state.groupsByWorktree[worktreeId] ?? []
  const tabs = state.unifiedTabsByWorktree[worktreeId] ?? []
  const panelGroupId = readClaudePanelGroupId(worktreeId)
  const chatOnly = (groupId: string): boolean => {
    const groupTabs = tabs.filter((tab) => tab.groupId === groupId)
    return groupTabs.length > 0 && groupTabs.every((tab) => tab.contentType === 'agent-session')
  }
  const candidates = groups.filter((group) => !chatOnly(group.id))
  return panelGroupId
    ? pickNonPanelGroupId(candidates, tabs, panelGroupId)
    : (state.activeGroupIdByWorktree[worktreeId] ?? candidates[0]?.id ?? null)
}

/** Ctrl+Shift+`: a new terminal in the workbench's Terminals section. */
export function newWorkbenchTerminal(worktreeId: string): void {
  const groupId = workbenchGroupId(worktreeId)
  if (groupId) {
    void useAppStore.getState().openNewTerminalTabInActiveWorkspace(groupId)
  }
}

/** Ctrl+`: the workbench's latest terminal, or a new one when it has none. */
export function showWorkbenchTerminals(worktreeId: string): void {
  const state = useAppStore.getState()
  const groupId = workbenchGroupId(worktreeId)
  const group = state.groupsByWorktree[worktreeId]?.find((candidate) => candidate.id === groupId)
  if (!group) {
    return
  }
  const groupTabs = (state.unifiedTabsByWorktree[worktreeId] ?? []).filter(
    (tab) => tab.groupId === group.id
  )
  const tabId = latestTabInSection(groupTabs, group.recentTabIds ?? [], 'terminals')
  if (!tabId) {
    newWorkbenchTerminal(worktreeId)
    return
  }
  state.activateTab(tabId, { worktreeId })
  focusTerminalTabSurface(tabId)
}

/** A new workbench terminal that starts by running `command` from the workspace root. */
export function runInWorkbenchTerminal(worktreeId: string, command: string): void {
  const groupId = workbenchGroupId(worktreeId)
  useAppStore.getState().createTab(worktreeId, groupId ?? undefined, undefined, {
    pendingStartup: { command }
  })
}
