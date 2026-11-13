import { describe, expect, it, vi } from 'vitest'
import { resolveCloudProjectOwner } from './cloud-target-owner'
import type { Store } from '../../persistence'

function fixtures() {
  const repo = { id: 'r', path: '/fixture', displayName: 'Fixture', badgeColor: '', addedAt: 0 }
  const repos: ReturnType<Store['getRepos']> = [repo]
  const folders: ReturnType<Store['getFolderWorkspaces']> = []
  const groups: ReturnType<Store['getProjectGroups']> = []
  const store = {
    getRepos: () => repos,
    getFolderWorkspaces: () => folders,
    getProjectGroups: () => groups
  }
  const resolve = vi.fn(async () => ({
    executionHostId: 'local',
    worktree: { id: 'r::/fixture', path: '/fixture' }
  }))
  return { store, repos, folders, groups, resolve, runtime: { resolveRuntimeFileTarget: resolve } }
}
describe('cloud target project ownership', () => {
  it('resolves a registered worktree through the existing owner resolver', async () => {
    const f = fixtures()
    expect(await resolveCloudProjectOwner(f.store, f.runtime, 'r::/fixture')).toEqual({
      hostId: 'local',
      root: '/fixture'
    })
    expect(f.resolve).toHaveBeenCalledWith('id:r::/fixture')
  })
  it('never resolves files or tools for remote and unresolved owners', async () => {
    for (const executionHostId of ['ssh:fixture', 'runtime:fixture'] as const) {
      const f = fixtures()
      f.repos[0].executionHostId = executionHostId
      expect(await resolveCloudProjectOwner(f.store, f.runtime, 'r::/fixture')).toBeNull()
      expect(f.resolve).not.toHaveBeenCalled()
    }
    const f = fixtures()
    await expect(
      resolveCloudProjectOwner(f.store, f.runtime, 'missing::/fixture')
    ).rejects.toThrow()
    expect(f.resolve).not.toHaveBeenCalled()
  })
  it('routes folder workspaces through the same authoritative resolver', async () => {
    const f = fixtures()
    f.folders.push({
      id: 'folder',
      projectGroupId: 'group',
      name: 'Folder',
      folderPath: '/fixture',
      linkedTask: null,
      comment: '',
      isArchived: false,
      isUnread: false,
      isPinned: false,
      sortOrder: 0,
      lastActivityAt: 0,
      createdAt: 0,
      updatedAt: 0
    })
    f.resolve.mockResolvedValue({
      executionHostId: 'local',
      worktree: { id: 'folder:folder', path: '/fixture' }
    })
    expect(await resolveCloudProjectOwner(f.store, f.runtime, 'folder:folder')).toEqual({
      hostId: 'local',
      root: '/fixture'
    })
    f.folders[0].executionHostId = 'runtime:remote'
    f.resolve.mockClear()
    expect(await resolveCloudProjectOwner(f.store, f.runtime, 'folder:folder')).toBeNull()
    expect(f.resolve).not.toHaveBeenCalled()
  })
  it('fences an owner change while resolution is pending', async () => {
    const f = fixtures()
    f.resolve.mockImplementation(async () => {
      f.repos[0].executionHostId = 'ssh:changed'
      return { executionHostId: 'local', worktree: { id: 'r::/fixture', path: '/fixture' } }
    })
    await expect(resolveCloudProjectOwner(f.store, f.runtime, 'r::/fixture')).rejects.toThrow(
      'not available'
    )
  })
  it('refuses resolver fallback or substituted project IDs', async () => {
    const f = fixtures()
    f.resolve.mockResolvedValue({
      executionHostId: 'runtime:other',
      worktree: { id: 'r::/fixture', path: '/fixture' }
    })
    await expect(resolveCloudProjectOwner(f.store, f.runtime, 'r::/fixture')).rejects.toThrow()
  })
})
