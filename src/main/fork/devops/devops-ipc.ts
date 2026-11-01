import { ipcMain } from 'electron'
import { statSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import { inspectDevopsWorkspace } from './devops-inspect'
import type { DevopsInspection } from '../../../shared/fork-devops-inspection'

const EMPTY: DevopsInspection = { findings: [], environment: 'path', shell: 'posix', tools: {} }

function isLocalDirectory(path: unknown): path is string {
  if (typeof path !== 'string' || !isAbsolute(path)) {
    return false
  }
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

/** Fork: the Toolbelt's view of a local workspace; SSH and missing paths get an empty one. */
export function registerDevopsHandlers(): void {
  ipcMain.handle('aiVault:inspectDevops', async (_event, workspacePath: unknown) =>
    isLocalDirectory(workspacePath) ? inspectDevopsWorkspace(workspacePath) : EMPTY
  )
}
