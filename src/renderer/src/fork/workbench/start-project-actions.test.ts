import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  openModal: vi.fn(),
  switchRuntime: vi.fn(),
  activate: vi.fn(),
  state: {
    activeWorktreeId: 'local-worktree',
    activeWorkspaceExecutionHostId: 'local',
    settings: { activeRuntimeEnvironmentId: null },
    repos: [
      { id: 'local-repo', executionHostId: 'local' },
      { id: 'remote-repo', executionHostId: 'runtime:remote' }
    ],
    worktreesByRepo: {
      local: [{ id: 'local-worktree', repoId: 'local-repo' }],
      remote: [{ id: 'remote-worktree', repoId: 'remote-repo' }]
    },
    folderWorkspaces: [
      { id: 'folder', executionHostId: 'runtime:folder', projectGroupId: 'group' }
    ],
    projectGroups: []
  }
}))
vi.mock('@/store', () => ({
  useAppStore: {
    getState: () => ({
      ...mocks.state,
      openModal: mocks.openModal,
      setActiveRuntimeEnvironmentPreference: mocks.switchRuntime
    })
  }
}))
vi.mock('@/store/selectors', () => ({
  selectKnownWorktreeById: (_state: unknown, id: string) =>
    Object.values(mocks.state.worktreesByRepo)
      .flat()
      .find((worktree) => worktree.id === id)
}))
vi.mock('@/lib/worktree-activation', () => ({ activateAndRevealWorkspace: mocks.activate }))

import {
  openStartProject,
  readStartProjectStep,
  selectStartEnvironment,
  startWorkspaceHost
} from './start-project-actions'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.switchRuntime.mockResolvedValue(true)
})

describe('start page project routing', () => {
  it.each([
    ['open', 'server-path'],
    ['clone', 'clone'],
    ['create', 'create']
  ] as const)('opens %s on its requested step and workspace host', (action, step) => {
    openStartProject(action, 'remote-worktree')
    expect(mocks.openModal).toHaveBeenCalledWith('add-repo', {
      initialStep: step,
      preferredHostId: 'runtime:remote'
    })
  })
  it('recognizes a folder workspace owner', () => {
    expect(startWorkspaceHost('folder:folder')).toBe('runtime:folder')
  })
  it('rejects non-start and invalid dialog steps', () => {
    expect(readStartProjectStep('nested')).toBe('add')
    expect(readStartProjectStep(undefined)).toBe('add')
  })
})

describe('start page environment switching', () => {
  it('checks reachability before activating a workspace owned by the selected runtime', async () => {
    await selectStartEnvironment('runtime:remote')
    expect(mocks.switchRuntime).toHaveBeenCalledWith('remote')
    expect(mocks.activate).toHaveBeenCalledWith('remote-worktree', {
      executionHostId: 'runtime:remote'
    })
    expect(mocks.switchRuntime.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.activate.mock.invocationCallOrder[0]
    )
  })
  it('does not activate or fall back locally when the runtime switch fails', async () => {
    mocks.switchRuntime.mockResolvedValue(false)
    await selectStartEnvironment('runtime:remote')
    expect(mocks.activate).not.toHaveBeenCalled()
    expect(mocks.openModal).not.toHaveBeenCalled()
  })
  it('opens the requested host filesystem when it has no workspaces', async () => {
    await selectStartEnvironment('runtime:empty')
    expect(mocks.openModal).toHaveBeenCalledWith('add-repo', {
      initialStep: 'server-path',
      preferredHostId: 'runtime:empty'
    })
    expect(mocks.activate).not.toHaveBeenCalled()
  })
  it('activates non-Git folders with explicit host ownership', async () => {
    await selectStartEnvironment('runtime:folder')
    expect(mocks.activate).toHaveBeenCalledWith('folder:folder', {
      executionHostId: 'runtime:folder'
    })
  })
  it('routes SSH connection through the existing host chooser without changing to local', async () => {
    await selectStartEnvironment('ssh:demo')
    expect(mocks.openModal).toHaveBeenCalledWith('add-repo', { preferredHostId: 'ssh:demo' })
    expect(mocks.switchRuntime).not.toHaveBeenCalled()
    expect(mocks.activate).not.toHaveBeenCalled()
  })
  it('returns to this computer and its own workspace', async () => {
    await selectStartEnvironment('local')
    expect(mocks.switchRuntime).toHaveBeenCalledWith(null)
    expect(mocks.activate).toHaveBeenCalledWith('local-worktree', { executionHostId: 'local' })
  })
})
