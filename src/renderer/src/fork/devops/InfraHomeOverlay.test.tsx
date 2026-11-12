// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({
  activeWorktreeId: 'alpha',
  groupsByWorktree: {
    alpha: [{ id: 'main', activeTabId: 'first' }],
    beta: [{ id: 'main', activeTabId: 'first' }]
  },
  unifiedTabsByWorktree: { alpha: [{ groupId: 'main' }], beta: [{ groupId: 'main' }] }
}))
const navigate = vi.hoisted(() => vi.fn())
vi.mock('@/store', () => ({
  useAppStore: (selector: (s: typeof state) => unknown) => selector(state)
}))
vi.mock('../workbench/workbench-terminals', () => ({ workbenchGroupId: () => 'main' }))
vi.mock('../project-workspaces/use-project-workspaces', () => ({
  isProjectDesktopWindow: () => true
}))
vi.mock('../workspace-desktop/workspace-desktop-state', () => ({
  useWorkspacePage: () => 'home',
  openWorkspacePage: navigate
}))
vi.mock('../workspace-desktop/WorkspacePages', () => ({
  WorkspacePages: () => <div>Workspace page</div>
}))
vi.mock('./infra-home-store', () => ({
  useInfraView: () => null,
  setInfraView: vi.fn(),
  setInfraOverlayTarget: vi.fn()
}))
vi.mock('../workbench/WorkbenchStart', () => ({ WorkbenchStart: () => null }))
import { InfraHomeOverlay } from './InfraHomeOverlay'
afterEach(() => {
  cleanup()
  navigate.mockClear()
  state.groupsByWorktree.beta[0].activeTabId = 'first'
})
it('renders the workspace page only in the active main group', () => {
  render(
    <>
      <InfraHomeOverlay worktreeId="alpha" groupId="main" />
      <InfraHomeOverlay worktreeId="alpha" groupId="dock" />
      <InfraHomeOverlay worktreeId="beta" groupId="main" />
    </>
  )
  expect(screen.getAllByText('Workspace page')).toHaveLength(1)
})
it('does not let a hidden project change the current workspace page', () => {
  const view = render(<InfraHomeOverlay worktreeId="beta" groupId="main" />)
  state.groupsByWorktree.beta[0].activeTabId = 'next'
  view.rerender(<InfraHomeOverlay worktreeId="beta" groupId="main" />)
  expect(navigate).not.toHaveBeenCalled()
})
