// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { WorkbenchAgentMenu } from './WorkbenchAgentMenu'

const mocks = vi.hoisted(() => ({ launch: vi.fn(), options: vi.fn() }))
vi.mock('@/hooks/useAgentDetectionTarget', () => ({
  useAgentDetectionTargetForWorktree: () => undefined
}))
vi.mock('@/components/tab-bar/use-new-tab-agent-menu-rows', () => ({
  useNewTabAgentMenuRows: () => ({ state: 'loading' })
}))
vi.mock('@/components/agent/use-agent-launch-picker-inventory', () => ({
  useAgentLaunchPickerInventory: () => []
}))
vi.mock('@/components/tab-bar/QuickLaunchButton', () => ({
  useTabAgentMenuLaunch: (options: unknown) => {
    mocks.options(options)
    return mocks.launch
  },
  ProjectedAgentMenuItems: ({ runLaunch }: { runLaunch: (row: unknown) => void }) => (
    <button onClick={() => runLaunch({ kind: 'chat', agent: 'codex', executionHostId: 'local' })}>
      Codex
    </button>
  )
}))
vi.mock('@/lib/focus-terminal-tab-surface', () => ({ focusTerminalTabSurface: vi.fn() }))
vi.mock('@/components/native-chat/use-native-chat-composer-reveal-focus', () => ({
  requestNativeChatComposerFocus: vi.fn()
}))
afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

it('offers selection without launching and forwards a draft in its owning workspace', () => {
  const delivered = vi.fn()
  render(
    <WorkbenchAgentMenu
      worktreeId="alpha"
      groupId="main-alpha"
      open
      onOpenChange={vi.fn()}
      prompt="Review this change"
      onPromptDelivered={delivered}
    >
      <button>Choose agent</button>
    </WorkbenchAgentMenu>
  )
  expect(mocks.launch).not.toHaveBeenCalled()
  expect(mocks.options).toHaveBeenLastCalledWith(
    expect.objectContaining({
      worktreeId: 'alpha',
      groupId: 'main-alpha',
      prompt: 'Review this change',
      promptDelivery: 'draft',
      onPromptDelivered: delivered
    })
  )
  fireEvent.click(screen.getByRole('button', { name: 'Codex' }))
  expect(mocks.launch).toHaveBeenCalledWith({
    kind: 'chat',
    agent: 'codex',
    executionHostId: 'local'
  })
  expect(delivered).not.toHaveBeenCalled()
})
