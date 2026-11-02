import { ipcMain } from 'electron'
import { statSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import { inspectDevopsWorkspace } from './devops-inspect'
import { readDevopsSandbox, runDevopsSandbox } from './devops-sandbox'
import { readDevopsContext } from './devops-context'
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

const SANDBOX_KINDS = new Set(['aws', 'cluster'])
const SANDBOX_ACTIONS = new Set(['start', 'stop', 'pause', 'resume'])

/** Fork F4: start, stop, pause and resume a workspace's local AWS (Floci) and cluster (vind). */
export function registerDevopsSandboxHandlers(): void {
  ipcMain.handle('aiVault:readDevopsSandbox', (_event, workspacePath: unknown) =>
    isLocalDirectory(workspacePath) ? readDevopsSandbox(workspacePath) : {}
  )
  ipcMain.handle('aiVault:runDevopsSandbox', async (_event, request: unknown) => {
    const workspacePath: unknown =
      request && typeof request === 'object' ? Reflect.get(request, 'workspacePath') : null
    const kind: unknown =
      request && typeof request === 'object' ? Reflect.get(request, 'kind') : null
    const action: unknown =
      request && typeof request === 'object' ? Reflect.get(request, 'action') : null
    if (
      !isLocalDirectory(workspacePath) ||
      typeof kind !== 'string' ||
      !SANDBOX_KINDS.has(kind) ||
      typeof action !== 'string' ||
      !SANDBOX_ACTIONS.has(action)
    ) {
      return { ok: false, error: 'Not a local workspace.', state: {} }
    }
    return runDevopsSandbox(
      workspacePath,
      kind === 'aws' ? 'aws' : 'cluster',
      action === 'start'
        ? 'start'
        : action === 'stop'
          ? 'stop'
          : action === 'pause'
            ? 'pause'
            : 'resume'
    )
  })
}

/** Fork A1: the context bar's view of where this workspace's commands land. */
export function registerDevopsContextHandlers(): void {
  ipcMain.handle('aiVault:readDevopsContext', (_event, request: unknown) => {
    const workspacePath: unknown =
      request && typeof request === 'object' ? Reflect.get(request, 'workspacePath') : null
    const terraformDir: unknown =
      request && typeof request === 'object' ? Reflect.get(request, 'terraformDir') : null
    return isLocalDirectory(workspacePath)
      ? readDevopsContext(workspacePath, typeof terraformDir === 'string' ? terraformDir : null)
      : {}
  })
}
