import { useAppStore } from '@/store'
import {
  appendToNativeChatComposerDraft,
  structuredAgentSessionDraftScopeKey
} from '@/components/native-chat/native-chat-composer-draft-store'
import { isStructuredTab } from '../../../../shared/structured-agent-session-tab'
import { launchClaudeChatInPanel } from '../claude-panel/ensure-claude-panel'
import { workbenchGroupId } from '../workbench/workbench-terminals'

const GOAL_PREAMBLE =
  'Do this in this workspace. Prefer local and free targets (kind, k3d, vind, Floci, Multipass). Use the repo’s mise tools. Show each command before running it, and ask before anything that creates billed cloud resources.\n\nGoal: '

/** The workspace's Claude chat: Bastion keeps it as a tab in the middle, beside files. */
function claudeChat(worktreeId: string): { tabId: string; sessionId: string } | null {
  const tab = (useAppStore.getState().unifiedTabsByWorktree[worktreeId] ?? []).findLast(
    (candidate) => isStructuredTab(candidate) && candidate.agentSessionAgent === 'claude'
  )
  return tab ? { tabId: tab.id, sessionId: tab.entityId } : null
}

/** A Launchpad goal, with the local-first and ask-before-billing rules in front. */
export function draftGoalForClaude(worktreeId: string, goal: string): void {
  draftForClaude(worktreeId, `${GOAL_PREAMBLE}${goal}`)
}

/** Text lands in the Claude chat's composer as a draft: the person reads it and presses Enter.
 *  With no chat open, one starts in the middle first. */
export function draftForClaude(worktreeId: string, text: string, attempt = 0): void {
  const chat = claudeChat(worktreeId)
  if (!chat) {
    const middle = workbenchGroupId(worktreeId)
    if (attempt === 0 && middle) {
      launchClaudeChatInPanel(worktreeId, middle, { focusComposer: true })
    }
    // A new chat appears a moment later.
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
