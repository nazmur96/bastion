import { openProjectWorkspaceDestination } from './workspace-destination'
import { registerIncognitoHandlers } from './incognito-ipc'
import { registerProjectWorkspaceArrival } from './workspace-arrival'
import { app, ipcMain } from 'electron'
import type { Store } from '../../persistence'
import { runBeforeRelaunchCleanup } from '../../app-relaunch'
import { quitProcess } from '../../startup/process-quit-request'
import { flushActiveProfileBeforeRelaunch } from '../../orca-profiles/profile-persistence-deadline'
import { WorkspaceCatalog } from './workspace-catalog'
import { readProjectWorkspaceContext } from './workspace-context'
import {
  PROJECT_WORKSPACE_HOME_ID,
  type ProjectWorkspaceList,
  type ProjectWorkspaceSwitchResult
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
    return run(catalog, context.activeId)
  } finally {
    catalog.close()
  }
}

function list(catalog: WorkspaceCatalog, activeId: string): ProjectWorkspaceList {
  return {
    activeId,
    workspaces: catalog.list(),
    switchMode: 'relaunch',
    incognitoTasks: catalog.incognito().list(),
    activeTask: catalog.incognito().get(activeId)
  }
}

// Home cards show what each workspace recorded about itself; home never reads another namespace.
function recordOwnSummary(store: Store): void {
  withCatalog((catalog, activeId) => {
    if (activeId !== PROJECT_WORKSPACE_HOME_ID) {
      catalog.recordRepoCount(activeId, store.getRepos().length)
    }
  })
}

export function registerProjectWorkspaceHandlers(
  store: Store,
  onBeforeRelaunch?: () => void | Promise<void>
): void {
  registerProjectWorkspaceArrival()
  withCatalog((catalog, activeId) => catalog.incognito().markActive(activeId))
  registerIncognitoHandlers(withCatalog, list)
  app.on('before-quit', () => {
    try {
      recordOwnSummary(store)
      withCatalog((catalog, activeId) => catalog.incognito().archiveOwn(activeId))
    } catch (error) {
      console.warn(
        '[project-workspaces] Summary not recorded:',
        error instanceof Error ? error.name : typeof error
      )
    }
  })
  ipcMain.handle('bastionWorkspaces:list', () => withCatalog(list))
  ipcMain.handle('bastionWorkspaces:create', (_event, args: unknown) =>
    withCatalog((catalog, activeId) => {
      if (activeId !== PROJECT_WORKSPACE_HOME_ID) {
        throw new Error('Create workspaces from application home.')
      }
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
        if (toId !== PROJECT_WORKSPACE_HOME_ID) {
          catalog.get(toId)
        }
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
        recordOwnSummary(store)
        withCatalog((catalog) => {
          if (toId === PROJECT_WORKSPACE_HOME_ID) {
            catalog.enterHome()
          } else {
            catalog.dataRoot(toId)
            catalog.select(toId)
          }
          catalog.incognito().archiveOwn(fromId)
        })
        await openProjectWorkspaceDestination(event.sender, toId)
        await runBeforeRelaunchCleanup(onBeforeRelaunch)
        if (!event.sender.isDestroyed()) {
          event.sender.send('app:restart-committed')
        }
        setTimeout(() => {
          quitProcess()
        }, 150)
        return { status: 'relaunching' }
      } catch (error) {
        switching = false
        withCatalog((catalog) => {
          if (fromId === PROJECT_WORKSPACE_HOME_ID) {
            catalog.enterHome()
          } else {
            catalog.select(fromId)
          }
          catalog.incognito().markActive(fromId)
        })
        throw error
      }
    }
  )
}
