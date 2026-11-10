import { requestDevWorkspaceRestart } from './workspace-dev-restart'
import { ipcMain } from 'electron'
import type { Store } from '../../persistence'
import { relaunchApp, runBeforeRelaunchCleanup } from '../../app-relaunch'
import { quitProcess } from '../../startup/process-quit-request'
import { flushActiveProfileBeforeRelaunch } from '../../orca-profiles/profile-persistence-deadline'
import { WorkspaceCatalog } from './workspace-catalog'
import { projectWorkspaceRelaunchArgs, readProjectWorkspaceContext } from './workspace-context'
import type {
  ProjectWorkspaceList,
  ProjectWorkspaceSwitchResult
} from '../../../shared/fork-project-workspaces'

function requestField(args: unknown, key: string): string {
  if (!args || typeof args !== 'object') {
    throw new Error('Invalid workspace request.')
  }
  const value: unknown = Reflect.get(args, key)
  if (typeof value !== 'string') {
    throw new Error('Invalid workspace request.')
  }
  return value
}

function withCatalog<T>(run: (catalog: WorkspaceCatalog, activeId: string) => T): T {
  const context = readProjectWorkspaceContext()
  if (!context) {
    throw new Error('Project workspace management is available in the desktop application.')
  }
  const catalog = new WorkspaceCatalog(context.baseRoot)
  try {
    return run(catalog, context.workspace.id)
  } finally {
    catalog.close()
  }
}

function list(catalog: WorkspaceCatalog, activeId: string): ProjectWorkspaceList {
  return { activeId, workspaces: catalog.list(), switchMode: 'relaunch' }
}

export function registerProjectWorkspaceHandlers(
  store: Store,
  onBeforeRelaunch?: () => void | Promise<void>
): void {
  ipcMain.handle('bastionWorkspaces:list', () => withCatalog(list))
  ipcMain.handle('bastionWorkspaces:create', (_event, args: unknown) =>
    withCatalog((catalog, activeId) => {
      catalog.create(requestField(args, 'name'))
      return list(catalog, activeId)
    })
  )
  ipcMain.handle('bastionWorkspaces:rename', (_event, args: unknown) =>
    withCatalog((catalog, activeId) => {
      catalog.rename(requestField(args, 'id'), requestField(args, 'name'))
      return list(catalog, activeId)
    })
  )
  let switching = false
  ipcMain.handle(
    'bastionWorkspaces:switch',
    async (event, args: unknown): Promise<ProjectWorkspaceSwitchResult> => {
      const fromId = requestField(args, 'fromId')
      const toId = requestField(args, 'toId')
      withCatalog((catalog, activeId) => {
        if (fromId !== activeId) {
          throw new Error('Workspace context changed. Refresh before switching.')
        }
        catalog.get(toId)
      })
      if (toId === fromId) {
        return { status: 'already-active' }
      }
      if (switching) {
        throw new Error('A workspace switch is already in progress.')
      }
      switching = true
      try {
        await flushActiveProfileBeforeRelaunch(store)
        const relaunchArgs = projectWorkspaceRelaunchArgs(process.argv.slice(1), toId)
        withCatalog((catalog) => {
          catalog.dataRoot(toId)
          catalog.select(toId)
        })
        await runBeforeRelaunchCleanup(onBeforeRelaunch)
        if (!event.sender.isDestroyed()) {
          event.sender.send('app:restart-committed')
        }
        setTimeout(() => {
          if (!requestDevWorkspaceRestart()) {
            relaunchApp('project-workspace-switch', undefined, { args: relaunchArgs })
          }
          quitProcess()
        }, 150)
        return { status: 'relaunching' }
      } catch (error) {
        switching = false
        throw error
      }
    }
  )
}
