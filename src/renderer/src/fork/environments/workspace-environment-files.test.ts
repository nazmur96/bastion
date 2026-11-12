import { beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  guard: vi.fn(),
  owner: { kind: 'runtime', environmentId: 'container' },
  route: { target: { kind: 'environment', environmentId: 'container' } }
}))
vi.mock('@/store', () => ({ useAppStore: { getState: () => ({ folderWorkspaces: [] }) } }))
vi.mock('@/store/selectors', () => ({
  selectKnownWorktreeById: () => ({ path: '/workspaces/project' })
}))
vi.mock('@/runtime/runtime-file-mutation-client', () => ({ readRuntimeDirectory: mocks.read }))
vi.mock('@/components/right-sidebar/file-explorer-operation-owner', () => ({
  getFileExplorerOperationOwner: () => mocks.owner,
  captureFileExplorerOperationGuard: () => ({ route: mocks.route, assertCurrent: mocks.guard })
}))
import { readWorkspaceEnvironmentFiles } from './workspace-environment-files'
beforeEach(() => {
  vi.clearAllMocks()
  mocks.guard.mockReset()
})
it('reads declarations through the owning runtime and keeps Dev Container evidence separate', async () => {
  mocks.read
    .mockResolvedValueOnce([
      { name: 'mise.toml', isDirectory: false },
      { name: '.devcontainer', isDirectory: true },
      { name: '.env', isDirectory: false }
    ])
    .mockResolvedValueOnce([{ name: 'devcontainer.json', isDirectory: false }])
  const result = await readWorkspaceEnvironmentFiles('remote-project')
  expect(result.files).toEqual(['mise.toml', '.devcontainer/devcontainer.json'])
  expect(mocks.read).toHaveBeenNthCalledWith(
    1,
    expect.objectContaining({
      target: { kind: 'environment', environmentId: 'container' },
      worktreeId: 'remote-project',
      worktreePath: '/workspaces/project'
    }),
    '/workspaces/project'
  )
  expect(mocks.guard).toHaveBeenCalledTimes(2)
})
it('discards an inspection whose owner changed during the read', async () => {
  mocks.read.mockResolvedValue([{ name: 'mise.toml', isDirectory: false }])
  mocks.guard.mockImplementation(() => {
    throw new Error('Owner changed')
  })
  await expect(readWorkspaceEnvironmentFiles('remote-project')).rejects.toThrow('Owner changed')
})
it('does not follow configuration directory symlinks', async () => {
  mocks.read.mockResolvedValue([{ name: '.devcontainer', isDirectory: true, isSymlink: true }])
  expect((await readWorkspaceEnvironmentFiles('remote-project')).files).toEqual([])
  expect(mocks.read).toHaveBeenCalledTimes(1)
})

it('recognizes a root Dev Container declaration without treating an unrelated JSON file as one', async () => {
  mocks.read.mockResolvedValue([
    { name: '.devcontainer.json', isDirectory: false },
    { name: 'devcontainer.json', isDirectory: false }
  ])
  const result = await readWorkspaceEnvironmentFiles('remote-project')
  expect(result.files).toEqual(['.devcontainer.json'])
  mocks.guard.mockImplementation(() => {
    throw new Error('Owner changed after review')
  })
  expect(() => result.assertCurrent()).toThrow('Owner changed after review')
})
