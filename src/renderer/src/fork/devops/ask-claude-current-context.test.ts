import { afterEach, expect, it, vi } from 'vitest'

const launch = vi.hoisted(() => vi.fn())
vi.mock('@/store', () => ({
  useAppStore: { getState: () => ({ unifiedTabsByWorktree: { demo: [] } }) }
}))
vi.mock('../claude-panel/ensure-claude-panel', () => ({ launchClaudeChatInPanel: launch }))
vi.mock('../workbench/workbench-terminals', () => ({ workbenchGroupId: () => 'main' }))
vi.mock('@/components/native-chat/native-chat-composer-draft-store', () => ({
  appendToNativeChatComposerDraft: vi.fn(),
  structuredAgentSessionDraftScopeKey: vi.fn()
}))

import { draftForClaude } from './ask-claude'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  launch.mockClear()
})

it('does not open a chat for an already stale contextual action', () => {
  draftForClaude('demo', 'Review this file', 0, () => false)
  expect(launch).not.toHaveBeenCalled()
})

it('stops deferred drafting when the user leaves the originating context', () => {
  vi.useFakeTimers()
  vi.stubGlobal('window', { setTimeout })
  let current = true
  draftForClaude('demo', 'Review this file', 0, () => current)
  expect(launch).toHaveBeenCalledOnce()
  current = false
  vi.advanceTimersByTime(300)
  expect(vi.getTimerCount()).toBe(0)
  expect(launch).toHaveBeenCalledOnce()
})
