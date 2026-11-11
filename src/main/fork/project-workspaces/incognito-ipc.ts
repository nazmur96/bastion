import { ipcMain } from 'electron'
import { existsSync, lstatSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { WorkspaceCatalog } from './workspace-catalog'
import type { ProjectWorkspaceList } from '../../../shared/fork-project-workspaces'

function field(args: unknown, key: string): unknown {
  if (!args || typeof args !== 'object') {
    return undefined
  }
  return Reflect.get(args, key)
}
export function registerIncognitoHandlers(
  withCatalog: <T>(run: (catalog: WorkspaceCatalog, activeId: string) => T) => T,
  list: (catalog: WorkspaceCatalog, activeId: string) => ProjectWorkspaceList
): void {
  ipcMain.handle('bastionIncognito:create', (_event, args: unknown) =>
    withCatalog((catalog, activeId) => {
      if (activeId !== 'home') {
        throw new Error('Start Incognito from application Home.')
      }
      const task = catalog
        .incognito()
        .create(field(args, 'kind'), field(args, 'fileName'), field(args, 'agent'))
      return { task, snapshot: list(catalog, activeId) }
    })
  )
  ipcMain.handle('bastionIncognito:prepare', () =>
    withCatalog((catalog, activeId) => {
      const task = catalog.incognito().get(activeId)
      if (!task) {
        return null
      }
      const root = catalog.incognito().scratch(activeId)
      if (lstatSync(root).isSymbolicLink()) {
        throw new Error('Incognito scratch folder cannot be redirected.')
      }
      const filePath = task.fileName ? join(root, task.fileName) : null
      if (filePath && !existsSync(filePath)) {
        writeFileSync(filePath, '', { flag: 'wx', mode: 0o600 })
      }
      return { task, root, filePath }
    })
  )
  ipcMain.handle('bastionIncognito:remove', async (_event, args: unknown) => {
    const id = field(args, 'id')
    if (typeof id !== 'string' || field(args, 'confirmed') !== true) {
      throw new Error('Confirm permanent deletion of this task.')
    }
    // Hold the catalog connection across asynchronous deletion.
    const catalog = withCatalog((catalog, activeId) => {
      if (activeId !== 'home') {
        throw new Error('Delete Incognito tasks from application Home.')
      }
      return new WorkspaceCatalog(catalog.baseRoot)
    })
    try {
      await catalog.incognito().remove(id)
      return list(catalog, 'home')
    } finally {
      catalog.close()
    }
  })
}
