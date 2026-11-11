import { WorkspaceCatalog } from './workspace-catalog'
import {
  isProjectWorkspaceLaunchTarget,
  PROJECT_WORKSPACE_HOME_ID
} from '../../../shared/fork-project-workspaces'
import type { ProjectWorkspace } from '../../../shared/fork-project-workspaces'

export const PROJECT_WORKSPACE_SWITCH = '--bastion-project-workspace='
export const PROJECT_WORKSPACE_ROOT_ENV = 'BASTION_PROJECT_WORKSPACE_DATA_ROOT'
// One-shot target from the development runner; packaged relaunches use the switch instead.
export const PROJECT_WORKSPACE_LAUNCH_ENV = 'BASTION_PROJECT_WORKSPACE_LAUNCH'

export type ProjectWorkspaceContext = {
  incognito?: boolean
  baseRoot: string
  dataRoot: string
  activeId: string
  // Null while application home is open.
  workspace: ProjectWorkspace | null
}

let context: ProjectWorkspaceContext | null = null

function launchTarget(argv: readonly string[], env: NodeJS.ProcessEnv): string {
  const flags = argv.filter((arg) => arg.startsWith(PROJECT_WORKSPACE_SWITCH))
  if (flags.length > 1) {
    throw new Error('Multiple project workspace selections are not supported.')
  }
  const requested =
    flags[0]?.slice(PROJECT_WORKSPACE_SWITCH.length) ?? env[PROJECT_WORKSPACE_LAUNCH_ENV]
  delete env[PROJECT_WORKSPACE_LAUNCH_ENV]
  if (requested === undefined) {
    return PROJECT_WORKSPACE_HOME_ID
  }
  if (!isProjectWorkspaceLaunchTarget(requested)) {
    throw new Error('Invalid project workspace ID.')
  }
  return requested
}

/** A cold launch opens application home; only an explicit switch opens a workspace. */
export function configureProjectWorkspace(
  baseRoot: string,
  setPath: (name: 'userData' | 'sessionData', path: string) => void,
  argv: readonly string[] = process.argv,
  env: NodeJS.ProcessEnv = process.env
): ProjectWorkspaceContext {
  const catalog = new WorkspaceCatalog(baseRoot)
  try {
    const target = launchTarget(argv, env)
    const workspace = target === PROJECT_WORKSPACE_HOME_ID ? null : catalog.get(target)
    if (workspace && catalog.incognito().get(workspace.id)?.deleting) {
      throw new Error('This Incognito task is being deleted.')
    }
    const dataRoot = workspace ? catalog.dataRoot(workspace.id) : catalog.homeRoot()
    if (workspace) {
      catalog.select(workspace.id)
      catalog.markOpened(workspace.id)
    } else {
      catalog.enterHome()
    }
    setPath('userData', dataRoot)
    setPath('sessionData', dataRoot)
    if (workspace?.kind === 'existing') {
      delete env[PROJECT_WORKSPACE_ROOT_ENV]
    } else {
      env[PROJECT_WORKSPACE_ROOT_ENV] = dataRoot
    }
    context = {
      incognito: Boolean(catalog.incognito().get(target)),
      baseRoot,
      dataRoot,
      activeId: workspace?.id ?? PROJECT_WORKSPACE_HOME_ID,
      workspace
    }
    return context
  } finally {
    catalog.close()
  }
}

export function readProjectWorkspaceContext(): ProjectWorkspaceContext | null {
  return context
}

export function projectWorkspaceRelaunchArgs(argv: readonly string[], id: string): string[] {
  if (!isProjectWorkspaceLaunchTarget(id)) {
    throw new Error('Invalid project workspace ID.')
  }
  return [
    ...argv.filter((arg) => !arg.startsWith(PROJECT_WORKSPACE_SWITCH)),
    `${PROJECT_WORKSPACE_SWITCH}${id}`
  ]
}
