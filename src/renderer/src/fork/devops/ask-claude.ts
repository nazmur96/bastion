import { useAppStore } from '@/store'
import {
  appendToNativeChatComposerDraft,
  structuredAgentSessionDraftScopeKey
} from '@/components/native-chat/native-chat-composer-draft-store'
import { isStructuredTab } from '../../../../shared/structured-agent-session-tab'
import { liveClaudePanelGroupId } from '../claude-panel/ensure-claude-panel'
import { showClaudePanel } from '../claude-panel/claude-panel-actions'

const GOAL_PREAMBLE =
  'Do this in this workspace. Prefer local and free targets (kind, k3d, vind, Floci, Multipass). Use the repo’s mise tools. Show each command before running it, and ask before anything that creates billed cloud resources.\n\nGoal: '

function panelChat(worktreeId: string): { tabId: string; sessionId: string } | null {
  const panel = liveClaudePanelGroupId(worktreeId)
  const tab = (useAppStore.getState().unifiedTabsByWorktree[worktreeId] ?? []).findLast(
    (candidate) =>
      candidate.groupId === panel &&
      isStructuredTab(candidate) &&
      candidate.agentSessionAgent === 'claude'
  )
  return tab ? { tabId: tab.id, sessionId: tab.entityId } : null
}

/** A Launchpad goal, with the local-first and ask-before-billing rules in front. */
export function draftGoalForClaude(worktreeId: string, goal: string): void {
  draftForClaude(worktreeId, `${GOAL_PREAMBLE}${goal}`)
}

/** Text lands in the Claude panel's composer as a draft: the person reads it and presses Enter. */
export function draftForClaude(worktreeId: string, text: string, attempt = 0): void {
  if (attempt === 0) {
    showClaudePanel(worktreeId)
  }
  const chat = panelChat(worktreeId)
  if (!chat) {
    // A new panel starts its chat a moment later.
    if (attempt < 10) {
      window.setTimeout(() => draftForClaude(worktreeId, text, attempt + 1), 300)
    }
    return
  }
  appendToNativeChatComposerDraft(structuredAgentSessionDraftScopeKey(chat.sessionId), {
    text
  })
  useAppStore.getState().activateTab(chat.tabId, { worktreeId })
}
