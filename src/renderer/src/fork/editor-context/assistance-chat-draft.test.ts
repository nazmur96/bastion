import { beforeEach, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => {
  const state: {
    activeWorktreeId: string
    unifiedTabsByWorktree: Record<
      string,
      {
        id: string
        entityId: string
        worktreeId: string
        executionHostId: string
        contentType: string
        agentSessionAgent: string
      }[]
    >
  } = { activeWorktreeId: 'wt', unifiedTabsByWorktree: {} }
  return { append: vi.fn(), update: vi.fn(), activate: vi.fn(), host: 'runtime:one', state }
})
vi.mock('@/store', () => ({
  useAppStore: { getState: () => ({ ...m.state, activateTab: m.activate }) }
}))
vi.mock('../workbench/start-project-actions', () => ({ startWorkspaceHost: () => m.host }))
vi.mock('@/runtime/structured-agent-session-owner', () => ({
  structuredAgentSessionOwnerForTab: (_state: unknown, tab: { executionHostId: string }) =>
    tab.executionHostId
}))
vi.mock('@/components/native-chat/native-chat-composer-draft-store', () => ({
  appendToNativeChatComposerDraft: m.append,
  structuredAgentSessionDraftScopeKey: (id: string) => `agent-session:${id}`
}))
vi.mock('./editor-context-store', () => ({ updateEditorContextChat: m.update }))
import { draftAssistanceInOpenChat } from './assistance-chat-draft'
beforeEach(() => {
  vi.clearAllMocks()
  m.host = 'runtime:one'
  m.state.activeWorktreeId = 'wt'
  m.state.unifiedTabsByWorktree = {
    wt: [
      {
        id: 'tab',
        entityId: 'chat',
        worktreeId: 'wt',
        executionHostId: 'runtime:one',
        contentType: 'agent-session',
        agentSessionAgent: 'codex'
      }
    ]
  }
})
it('uses an existing selected Codex composer, skips implicit editor context and never launches/sends', () => {
  expect(draftAssistanceInOpenChat('wt', 'tab', 'runtime:one', 'bounded draft', () => true)).toBe(
    true
  )
  expect(m.append).toHaveBeenCalledWith('agent-session:chat', { text: 'bounded draft' })
  expect(m.update).toHaveBeenCalledWith('agent-session:chat', { skipNext: true })
  expect(m.activate).toHaveBeenCalledWith('tab', { worktreeId: 'wt' })
})
it('works with an existing Claude composer without choosing it as the default', () => {
  m.state.unifiedTabsByWorktree.wt[0].agentSessionAgent = 'claude'
  expect(draftAssistanceInOpenChat('wt', 'tab', 'runtime:one', 'bounded draft', () => true)).toBe(
    true
  )
})
it('refuses stale context, wrong host, switched workspace, closed chat and oversized text', () => {
  expect(draftAssistanceInOpenChat('wt', 'tab', 'runtime:one', 'draft', () => false)).toBe(false)
  expect(draftAssistanceInOpenChat('wt', 'tab', 'local', 'draft', () => true)).toBe(false)
  expect(draftAssistanceInOpenChat('wt', 'gone', 'runtime:one', 'draft', () => true)).toBe(false)
  expect(draftAssistanceInOpenChat('wt', 'tab', 'runtime:one', 'a'.repeat(2401), () => true)).toBe(
    false
  )
  m.state.activeWorktreeId = 'other'
  expect(draftAssistanceInOpenChat('wt', 'tab', 'runtime:one', 'draft', () => true)).toBe(false)
  expect(m.append).not.toHaveBeenCalled()
})
it.each(['local', 'runtime:one'])(
  'refuses conversation IDs mirrored in another worktree on %s',
  (executionHostId) => {
    m.state.unifiedTabsByWorktree.other = [
      {
        ...m.state.unifiedTabsByWorktree.wt[0],
        id: 'other',
        worktreeId: 'other',
        executionHostId
      }
    ]
    expect(draftAssistanceInOpenChat('wt', 'tab', 'runtime:one', 'draft', () => true)).toBe(false)
    expect(m.append).not.toHaveBeenCalled()
  }
)
