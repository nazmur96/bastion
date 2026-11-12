import { useAppStore } from '@/store'
import { selectKnownWorktreeById } from '@/store/selectors'
import { activateAndRevealWorkspace } from '@/lib/worktree-activation'
import {
  UNRESOLVED_OWNER_HOST_ID,
  getWorktreeExecutionHostId,
  parseExecutionHostId,
  type ExecutionHostId
} from '../../../../shared/execution-host'
import { getFolderWorkspaceHostId } from '../../../../shared/folder-workspace-execution-host'
import { folderWorkspaceKey } from '../../../../shared/workspace-scope'

export function readStartProjectStep(value: unknown): 'add' | 'clone' | 'create' | 'server-path' {
  return value === 'clone' || value === 'create' || value === 'server-path' ? value : 'add'
}

export function startWorkspaceHost(workspaceId: string): ExecutionHostId {
  const state = useAppStore.getState()
  const worktree = selectKnownWorktreeById(state, workspaceId)
  if (worktree) {
    return getWorktreeExecutionHostId(
      worktree,
      state.repos.find((repo) => repo.id === worktree.repoId)
    )
  }
  const folder = state.folderWorkspaces.find(
    (entry) => folderWorkspaceKey(entry.id) === workspaceId
  )
  return folder ? getFolderWorkspaceHostId(folder, state.projectGroups) : UNRESOLVED_OWNER_HOST_ID
}

export function openStartProject(action: 'open' | 'clone' | 'create', workspaceId: string): void {
  if (startWorkspaceHost(workspaceId) === UNRESOLVED_OWNER_HOST_ID) {
    return
  }
  useAppStore.getState().openModal('add-repo', {
    initialStep: action === 'open' ? 'server-path' : action,
    preferredHostId: startWorkspaceHost(workspaceId)
  })
}

export async function selectStartEnvironment(hostId: ExecutionHostId): Promise<void> {
  const host = parseExecutionHostId(hostId)
  if (!host || hostId === UNRESOLVED_OWNER_HOST_ID) {
    return
  }
  const switched =
    host.kind === 'ssh' ||
    (await useAppStore
      .getState()
      .setActiveRuntimeEnvironmentPreference(host.kind === 'runtime' ? host.environmentId : null))
  if (!switched) {
    return
  }
  const state = useAppStore.getState()
  const worktrees = Object.values(state.worktreesByRepo)
    .flat()
    .filter(
      (worktree) =>
        getWorktreeExecutionHostId(
          worktree,
          state.repos.find((repo) => repo.id === worktree.repoId)
        ) === hostId
    )
  const worktree = worktrees.find((entry) => entry.id === state.activeWorktreeId) ?? worktrees[0]
  const folder = state.folderWorkspaces.find(
    (entry) => getFolderWorkspaceHostId(entry, state.projectGroups) === hostId
  )
  const workspaceId = worktree?.id ?? (folder ? folderWorkspaceKey(folder.id) : null)
  if (workspaceId) {
    activateAndRevealWorkspace(workspaceId, { executionHostId: hostId })
  } else {
    state.openModal('add-repo', { initialStep: 'server-path', preferredHostId: hostId })
  }
}
