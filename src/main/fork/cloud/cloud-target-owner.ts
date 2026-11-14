import type { Store } from '../../persistence'
import { isRepoOnCatalogHost } from '../../../shared/execution-host'
import { resolveFolderWorkspaceHost } from '../../../shared/folder-workspace-execution-host'
import { splitWorktreeIdForFilesystem } from '../../../shared/worktree/id'
import {
  CloudTargetRefusal,
  type CloudOwner
} from '../../../shared/fork-cloud/cloud-target-contract'

type CatalogStore = Pick<Store, 'getRepos' | 'getFolderWorkspaces' | 'getProjectGroups'>
export type CloudProjectRuntime = {
  getRuntimeId?(): string
  resolveRuntimeFileTarget(
    selector: string
  ): Promise<{ executionHostId: string; worktree: { id: string; path: string } }>
}
export function cloudProjectRegistration(
  store: CatalogStore,
  projectId: string
): { local: boolean; stamp: string } {
  const repos = store.getRepos()
  if (projectId.startsWith('folder:')) {
    const id = projectId.slice(7)
    const folders = store.getFolderWorkspaces().filter((folder) => folder.id === id)
    if (folders.length !== 1) {
      throw new CloudTargetRefusal('owner')
    }
    const groups = store.getProjectGroups()
    const host = resolveFolderWorkspaceHost(
      { repos, folderWorkspaces: folders, projectGroups: groups },
      id
    )
    const local = host.kind === 'local' && isRepoOnCatalogHost(folders[0])
    return { local, stamp: JSON.stringify([folders, groups, repos]) }
  }
  const parsed = splitWorktreeIdForFilesystem(projectId)
  const matches = parsed ? repos.filter((repo) => repo.id === parsed.repoId) : []
  if (matches.length !== 1) {
    throw new CloudTargetRefusal('owner')
  }
  return { local: isRepoOnCatalogHost(matches[0]), stamp: JSON.stringify(matches) }
}
export async function resolveCloudProjectOwner(
  store: CatalogStore,
  runtime: CloudProjectRuntime,
  projectId: string
): Promise<CloudOwner | null> {
  const before = cloudProjectRegistration(store, projectId)
  if (!before.local) {
    return null
  }
  const target = await runtime.resolveRuntimeFileTarget(`id:${projectId}`)
  const after = cloudProjectRegistration(store, projectId)
  if (
    !after.local ||
    before.stamp !== after.stamp ||
    target.executionHostId !== 'local' ||
    target.worktree.id !== projectId
  ) {
    throw new CloudTargetRefusal('owner')
  }
  return { hostId: 'local', root: target.worktree.path }
}
