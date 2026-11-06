import { useAppStore } from '@/store'
import { focusTerminalTabSurface } from '@/lib/focus-terminal-tab-surface'
import { readClaudePanelGroupId } from '../claude-panel/claude-panel-registry'
import { pickNonPanelGroupId } from '../claude-panel/claude-panel-layout'
import { latestTabInSection } from './workbench-sections'
import { ensureTerminalDock, liveTerminalDockId } from './terminal-dock'

/** The workbench column: not the Claude panel, not the terminal dock, preferably not a side chat. */
export function workbenchGroupId(worktreeId: string): string | null {
  const state = useAppStore.getState()
  const groups = state.groupsByWorktree[worktreeId] ?? []
  const tabs = state.unifiedTabsByWorktree[worktreeId] ?? []
  const panelGroupId = readClaudePanelGroupId(worktreeId)
  const chatOnly = (groupId: string): boolean => {
    const groupTabs = tabs.filter((tab) => tab.groupId === groupId)
    return groupTabs.length > 0 && groupTabs.every((tab) => tab.contentType === 'agent-session')
  }
  const dock = liveTerminalDockId(worktreeId)
  if (panelGroupId) {
    const candidates = groups.filter((group) => !chatOnly(group.id) && group.id !== dock)
    return pickNonPanelGroupId(candidates, tabs, panelGroupId)
  }
  // Bastion keeps the main chat in the middle, so a group of only chats can be the workbench;
  // one that also holds files or pages wins over a side chat.
  const groupsOutsideDock = groups.filter((group) => group.id !== dock)
  return (
    groupsOutsideDock.find((group) => !chatOnly(group.id))?.id ?? groupsOutsideDock[0]?.id ?? null
  )
}

/** The terminal dock under the workbench, where every workbench terminal opens. */
export function terminalGroupId(worktreeId: string): string | null {
  const workbench = workbenchGroupId(worktreeId)
  return workbench ? (ensureTerminalDock(worktreeId, workbench) ?? workbench) : null
}

/** Ctrl+Shift+`: a new terminal in the terminal dock. */
export function newWorkbenchTerminal(worktreeId: string): void {
  const groupId = terminalGroupId(worktreeId)
  if (groupId) {
    void useAppStore.getState().openNewTerminalTabInActiveWorkspace(groupId)
  }
}

/** Ctrl+`: the workbench's latest terminal, or a new one when it has none. */
export function showWorkbenchTerminals(worktreeId: string): void {
  const state = useAppStore.getState()
  const groupId = terminalGroupId(worktreeId)
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
export function runInWorkbenchTerminal(
  worktreeId: string,
  command: string,
  env?: Record<string, string>
): void {
  const groupId = terminalGroupId(worktreeId)
  useAppStore.getState().createTab(worktreeId, groupId ?? undefined, undefined, {
    pendingStartup: { command, ...(env && Object.keys(env).length > 0 ? { env } : {}) }
  })
}

/** A browser tab in the workbench, e.g. a local tool's dashboard. */
export function openInWorkbenchBrowser(worktreeId: string, url: string, title: string): void {
  useAppStore.getState().createBrowserTab(worktreeId, url, {
    title,
    targetGroupId: workbenchGroupId(worktreeId) ?? undefined
  })
}
