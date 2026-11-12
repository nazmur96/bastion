import { UNRESOLVED_OWNER_HOST_ID } from '../../../../shared/execution-host'
import { useAppStore } from '@/store'
import { isStructuredTab } from '../../../../shared/structured-agent-session-tab'
import { structuredAgentSessionOwnerForTab } from '@/runtime/structured-agent-session-owner'
import {
  appendToNativeChatComposerDraft,
  structuredAgentSessionDraftScopeKey
} from '@/components/native-chat/native-chat-composer-draft-store'
import { startWorkspaceHost } from '../workbench/start-project-actions'
import { updateEditorContextChat } from './editor-context-store'

/** Existing composer transport only: no session launch, terminal input or model submission. */
export function draftAssistanceInOpenChat(
  worktreeId: string,
  tabId: string,
  hostId: string,
  text: string,
  isCurrent: () => boolean
): boolean {
  const state = useAppStore.getState()
  if (
    hostId === UNRESOLVED_OWNER_HOST_ID ||
    !text.trim() ||
    !isCurrent() ||
    state.activeWorktreeId !== worktreeId ||
    startWorkspaceHost(worktreeId) !== hostId ||
    text.length > 2400
  ) {
    return false
  }
  const tab = state.unifiedTabsByWorktree[worktreeId]?.find((tab) => tab.id === tabId)
  if (!tab || !isStructuredTab(tab) || structuredAgentSessionOwnerForTab(state, tab) !== hostId) {
    return false
  }
  const ambiguous = Object.values(state.unifiedTabsByWorktree).some((tabs) =>
    tabs.some(
      (other) =>
        isStructuredTab(other) &&
        other.entityId === tab.entityId &&
        structuredAgentSessionOwnerForTab(state, other) !== hostId
    )
  )
  if (ambiguous) {
    return false
  }
  const scope = structuredAgentSessionDraftScopeKey(tab.entityId)
  appendToNativeChatComposerDraft(scope, { text })
  updateEditorContextChat(scope, { skipNext: true })
  state.activateTab(tab.id, { worktreeId })
  return true
}
