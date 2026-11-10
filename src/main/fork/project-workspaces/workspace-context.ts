import { WorkspaceCatalog } from './workspace-catalog'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { isProjectWorkspaceId } from '../../../shared/fork-project-workspaces'
import type { ProjectWorkspace } from '../../../shared/fork-project-workspaces'

export const PROJECT_WORKSPACE_SWITCH = '--bastion-project-workspace='
export const PROJECT_WORKSPACE_ROOT_ENV = 'BASTION_PROJECT_WORKSPACE_DATA_ROOT'

export type ProjectWorkspaceContext = {
  baseRoot: string
  dataRoot: string
  workspace: ProjectWorkspace
}

let context: ProjectWorkspaceContext | null = null

export function configureProjectWorkspace(
  baseRoot: string,
  setPath: (name: 'userData' | 'sessionData', path: string) => void,
  argv: readonly string[] = process.argv,
  env: NodeJS.ProcessEnv = process.env
): ProjectWorkspaceContext {
  if (
    !existsSync(join(baseRoot, 'bastion-project-workspaces', 'catalog.db')) &&
    !argv.some((arg) => arg.startsWith(PROJECT_WORKSPACE_SWITCH))
  ) {
    delete env[PROJECT_WORKSPACE_ROOT_ENV]
    context = {
      baseRoot,
      dataRoot: baseRoot,
      workspace: {
        id: 'existing',
        name: 'Existing projects',
        kind: 'existing',
        createdAt: 0,
        updatedAt: 0
      }
    }
    return context
  }
  const catalog = new WorkspaceCatalog(baseRoot)
  try {
    const flags = argv.filter((arg) => arg.startsWith(PROJECT_WORKSPACE_SWITCH))
    if (flags.length > 1) {
      throw new Error('Multiple project workspace selections are not supported.')
    }
    const workspace = flags[0]
      ? catalog.get(flags[0].slice(PROJECT_WORKSPACE_SWITCH.length))
      : catalog.selected()
    const dataRoot = catalog.dataRoot(workspace.id)
    setPath('userData', dataRoot)
    setPath('sessionData', dataRoot)
    if (workspace.kind === 'isolated') {
      env[PROJECT_WORKSPACE_ROOT_ENV] = dataRoot
    } else {
      delete env[PROJECT_WORKSPACE_ROOT_ENV]
    }
    context = { baseRoot, dataRoot, workspace }
    return context
  } finally {
    catalog.close()
  }
}

export function readProjectWorkspaceContext(): ProjectWorkspaceContext | null {
  return context
}

export function projectWorkspaceRelaunchArgs(argv: readonly string[], id: string): string[] {
  if (!isProjectWorkspaceId(id)) {
    throw new Error('Invalid project workspace ID.')
  }
  return [
    ...argv.filter((arg) => !arg.startsWith(PROJECT_WORKSPACE_SWITCH)),
    `${PROJECT_WORKSPACE_SWITCH}${id}`
  ]
}
