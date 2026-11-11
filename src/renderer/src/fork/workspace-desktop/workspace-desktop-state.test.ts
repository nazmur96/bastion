import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  setActiveView: vi.fn(),
  section: vi.fn(),
  collapsed: vi.fn(() => false),
  toggle: vi.fn(),
  infra: vi.fn()
}))
vi.mock('@/store', () => ({
  useAppStore: {
    getState: () => ({ activeWorktreeId: 'alpha', setActiveView: mocks.setActiveView })
  }
}))
vi.mock('../workbench/side-panel-store', () => ({ setSideSection: mocks.section }))
vi.mock('../workbench/terminal-dock', () => ({
  isSidePanelCollapsed: mocks.collapsed,
  toggleSidePanel: mocks.toggle
}))
vi.mock('../devops/infra-home-store', () => ({ setInfraView: mocks.infra }))
vi.mock('../workbench/workbench-focus', () => ({ restoreWorkbenchLayout: vi.fn() }))
import { openWorkspacePage } from './workspace-desktop-state'
beforeEach(() => {
  vi.clearAllMocks()
  mocks.collapsed.mockReturnValue(false)
})
it('opens existing source control in the selected context and restores a collapsed panel', () => {
  mocks.collapsed.mockReturnValue(true)
  openWorkspacePage('source')
  expect(mocks.section).toHaveBeenCalledWith('alpha', 'changes')
  expect(mocks.toggle).toHaveBeenCalledWith('alpha')
  expect(mocks.setActiveView).toHaveBeenCalledWith('terminal')
})
it('opening home leaves the existing panel selection and layout untouched', () => {
  openWorkspacePage('home')
  expect(mocks.section).not.toHaveBeenCalled()
  expect(mocks.toggle).not.toHaveBeenCalled()
  expect(mocks.infra).not.toHaveBeenCalled()
})
it('editor navigation dismisses an old infrastructure overlay and selects files', () => {
  openWorkspacePage('editor')
  expect(mocks.infra).toHaveBeenCalledWith('alpha', null)
  expect(mocks.section).toHaveBeenCalledWith('alpha', 'files')
})
