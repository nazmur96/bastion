/** Application home runs in its own empty namespace, outside every project workspace. */
export const PROJECT_WORKSPACE_HOME_ID = 'home'

export type IncognitoKind = 'terminal' | 'browser' | 'agent' | 'file'
export function isIncognitoKind(value: unknown): value is IncognitoKind {
  return value === 'terminal' || value === 'browser' || value === 'agent' || value === 'file'
}
export type IncognitoTask = {
  workspace: ProjectWorkspace
  kind: IncognitoKind
  archivedAt: number | null
  deleting: boolean
  fileName: string | null
  agent: 'claude' | 'codex'
}

export type ProjectWorkspace = {
  id: string
  name: string
  kind: 'existing' | 'isolated'
  createdAt: number
  updatedAt: number
  // Recorded by the workspace itself when it closes; null until then.
  repoCount: number | null
  openedAt: number | null
}

/**
 * The built-in workspace for upstream projects is listed only when it holds something: a fresh
 * install records it as empty, and an empty one that was never opened is left out.
 */
export function isListedWorkspace(workspace: ProjectWorkspace): boolean {
  return !(
    workspace.kind === 'existing' &&
    workspace.repoCount === 0 &&
    workspace.openedAt === null
  )
}

export type ProjectWorkspaceList = {
  // PROJECT_WORKSPACE_HOME_ID while application home is open.
  activeId: string
  workspaces: ProjectWorkspace[]
  switchMode: 'relaunch'
  incognitoTasks?: IncognitoTask[]
  activeTask?: IncognitoTask | null
}

export type ProjectWorkspaceSwitchResult = { status: 'already-active' | 'relaunching' }

export type ProjectWorkspacesApi = {
  incognito?: {
    create: (args: {
      kind: IncognitoKind
      fileName?: string
      agent?: 'claude' | 'codex'
    }) => Promise<{ task: IncognitoTask; snapshot: ProjectWorkspaceList }>
    remove: (args: { id: string; confirmed: true }) => Promise<ProjectWorkspaceList>
    prepare: () => Promise<{ task: IncognitoTask; root: string; filePath: string | null } | null>
  }
  ready?: () => Promise<void>
  list: () => Promise<ProjectWorkspaceList>
  create: (args: { name: string }) => Promise<ProjectWorkspaceList>
  rename: (args: { id: string; name: string }) => Promise<ProjectWorkspaceList>
  switch: (args: { fromId: string; toId: string }) => Promise<ProjectWorkspaceSwitchResult>
}

export function isProjectWorkspaceId(value: unknown): value is string {
  return (
    value === 'existing' ||
    (typeof value === 'string' &&
      /^workspace-[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(value))
  )
}

export function isProjectWorkspaceLaunchTarget(value: unknown): value is string {
  return value === PROJECT_WORKSPACE_HOME_ID || isProjectWorkspaceId(value)
}

export function projectWorkspaceName(value: unknown): string {
  if (typeof value !== 'string') {
    throw new Error('A workspace name is required.')
  }
  const name = value.trim()
  if (!name || name.length > 80 || /\p{Cc}/u.test(name)) {
    throw new Error('Use a workspace name of 1–80 characters without control characters.')
  }
  return name
}
