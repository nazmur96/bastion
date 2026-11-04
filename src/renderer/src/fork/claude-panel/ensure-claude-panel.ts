import { useAppStore } from '@/store'
import { captureNativeChatComposerFocusIntent } from '@/components/native-chat/use-native-chat-composer-reveal-focus'
import { adoptAgentSessionLaunchVerdict } from '@/lib/agent-session-launch-plan'
import { newAgentLaunchRequestId } from '@/lib/agent-launch-request-id'
import { beginStructuredAgentSessionProvisionalLaunch } from '@/lib/agent-session/structured-agent-session-provisional-tab'
import { isStructuredTab } from '../../../../shared/structured-agent-session-tab'
import {
  isClaudePanelHidden,
  readClaudePanelGroupId,
  setClaudePanelGroupId
} from './claude-panel-registry'
import {
  containsGroup,
  findAdoptablePanelGroupId,
  findGroupSplit,
  pickNonPanelGroupId,
  rightmostLeafGroupId
} from './claude-panel-layout'

/** Share of the width the editor side keeps when the panel is first created. */
export const CLAUDE_PANEL_EDITOR_RATIO = 0.62

const inFlight = new Set<string>()

/** The registered panel, only while its group is still on screen in the workspace layout. */
export function liveClaudePanelGroupId(worktreeId: string): string | null {
  const groupId = readClaudePanelGroupId(worktreeId)
  const state = useAppStore.getState()
  const layout = state.layoutByWorktree[worktreeId]
  const groups = state.groupsByWorktree[worktreeId] ?? []
  return groupId &&
    layout &&
    containsGroup(layout, groupId) &&
    groups.some((group) => group.id === groupId)
    ? groupId
    : null
}

export function launchClaudeChatInPanel(
  worktreeId: string,
  groupId: string,
  options: { focusComposer?: boolean } = {}
): void {
  const plan = adoptAgentSessionLaunchVerdict({
    route: 'structured-native-chat',
    requestId: newAgentLaunchRequestId(),
    agent: 'claude',
    worktreeId
  })
  const launch = beginStructuredAgentSessionProvisionalLaunch({
    plan,
    hooks: {},
    targetGroupId: groupId,
    ...(options.focusComposer ? { focusIntent: captureNativeChatComposerFocusIntent() } : {})
  })
  if (!launch) {
    console.warn('[claude-panel] could not start a Claude chat in the panel')
  }
}

/** Claude chats outside the panel; Orca keeps the groups they leave, so the editor area stays. */
function movableClaudeChats(worktreeId: string, panelGroupId: string): string[] {
  return (useAppStore.getState().unifiedTabsByWorktree[worktreeId] ?? [])
    .filter(
      (tab) =>
        tab.groupId !== panelGroupId && isStructuredTab(tab) && tab.agentSessionAgent === 'claude'
    )
    .map((tab) => tab.id)
}

/** A new workspace's only chat moved into the panel and its group was pruned: give back an empty
 *  workbench beside it, or the Infra home and the editor sections have nowhere to show. */
function keepWorkbenchBeside(worktreeId: string, panel: string): void {
  const state = useAppStore.getState()
  const groups = state.groupsByWorktree[worktreeId] ?? []
  const tabs = state.unifiedTabsByWorktree[worktreeId] ?? []
  if (!pickNonPanelGroupId(groups, tabs, panel)) {
    state.createEmptySplitGroup(worktreeId, panel, 'left', { activate: true })
  }
}

function applyInitialPanelWidth(worktreeId: string, panel: string): void {
  keepWorkbenchBeside(worktreeId, panel)
  const state = useAppStore.getState()
  const layout = state.layoutByWorktree[worktreeId]
  const split = layout ? findGroupSplit(layout, panel) : null
  if (split) {
    state.setTabGroupSplitRatio(
      worktreeId,
      split.path,
      split.side === 'second' ? CLAUDE_PANEL_EDITOR_RATIO : 1 - CLAUDE_PANEL_EDITOR_RATIO
    )
  }
}

/** Give the workspace its Claude column on the right, once, unless the user hid the panel. */
export function ensureClaudePanel(worktreeId: string): void {
  if (isClaudePanelHidden() || inFlight.has(worktreeId)) {
    return
  }
  const live = liveClaudePanelGroupId(worktreeId)
  if (live) {
    // A workspace saved with only the panel left gets its workbench back on open.
    keepWorkbenchBeside(worktreeId, live)
    return
  }
  const state = useAppStore.getState()
  const layout = state.layoutByWorktree[worktreeId]
  if (!layout || (state.groupsByWorktree[worktreeId] ?? []).length === 0) {
    return
  }
  const adopted =
    layout.type === 'split'
      ? findAdoptablePanelGroupId(layout, state.unifiedTabsByWorktree[worktreeId] ?? [])
      : null
  if (adopted) {
    // The saved id went stale (e.g. set before the layout was restored); take the column back.
    setClaudePanelGroupId(worktreeId, adopted)
    return
  }
  inFlight.add(worktreeId)
  try {
    const panel = state.createEmptySplitGroup(worktreeId, rightmostLeafGroupId(layout), 'right', {
      activate: false
    })
    if (!panel) {
      return
    }
    setClaudePanelGroupId(worktreeId, panel)
    const after = useAppStore.getState()
    const moving = movableClaudeChats(worktreeId, panel)
    for (const tabId of moving) {
      after.moveUnifiedTabToGroup(tabId, panel, { activate: true })
    }
    if (moving.length === 0) {
      launchClaudeChatInPanel(worktreeId, panel)
    }
    // Emptied groups are pruned after the moves, which rebuilds the split; size it once that settles.
    setTimeout(() => applyInitialPanelWidth(worktreeId, panel), 0)
  } finally {
    inFlight.delete(worktreeId)
  }
}
