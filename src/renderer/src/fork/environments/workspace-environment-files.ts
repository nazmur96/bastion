import { useAppStore } from '@/store'
import { selectKnownWorktreeById } from '@/store/selectors'
import { joinPath } from '@/lib/path'
import { folderWorkspaceKey } from '../../../../shared/workspace-scope'
import { readRuntimeDirectory } from '@/runtime/runtime-file-mutation-client'
import {
  captureFileExplorerOperationGuard,
  getFileExplorerOperationOwner
} from '@/components/right-sidebar/file-explorer-operation-owner'

const CONFIG_FILES = [
  'mise.toml',
  '.mise.toml',
  'devenv.nix',
  '.devcontainer.json',
  'compose.yaml',
  'compose.yml',
  'docker-compose.yml',
  'docker-compose.yaml',
  'orca.yaml'
]
export type WorkspaceEnvironmentFiles = {
  root: string
  files: string[]
  assertCurrent: () => unknown
}
/** The project's root and its owner's file route, pinned so a later owner change is detected. */
export function captureProjectFileRoute(worktreeId: string) {
  const state = useAppStore.getState()
  const root =
    selectKnownWorktreeById(state, worktreeId)?.path ??
    state.folderWorkspaces.find((folder) => folderWorkspaceKey(folder.id) === worktreeId)
      ?.folderPath
  if (!root) {
    throw new Error('The project path is not available.')
  }
  const owner = getFileExplorerOperationOwner(worktreeId)
  const guard = captureFileExplorerOperationGuard(worktreeId, owner)
  return { root, guard, context: { ...guard.route, worktreeId, worktreePath: root } }
}

export async function readWorkspaceEnvironmentFiles(
  worktreeId: string
): Promise<WorkspaceEnvironmentFiles> {
  const { root, guard, context } = captureProjectFileRoute(worktreeId)
  const entries = await readRuntimeDirectory(context, root)
  guard.assertCurrent()
  const files = entries
    .filter((entry) => !entry.isDirectory && !entry.isSymlink && CONFIG_FILES.includes(entry.name))
    .map((entry) => entry.name)
  if (
    entries.some((entry) => entry.name === '.devcontainer' && entry.isDirectory && !entry.isSymlink)
  ) {
    const nested = await readRuntimeDirectory(context, joinPath(root, '.devcontainer'))
    guard.assertCurrent()
    if (
      nested.some(
        (entry) => entry.name === 'devcontainer.json' && !entry.isDirectory && !entry.isSymlink
      )
    ) {
      files.push('.devcontainer/devcontainer.json')
    }
  }
  return { root, files, assertCurrent: guard.assertCurrent }
}
