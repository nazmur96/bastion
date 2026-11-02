import { ipcMain } from 'electron'
import { existsSync, statSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { MISE_FILES, inspectDevopsWorkspace, resolveTool } from './devops-inspect'
import { listLocalRuns } from './devops-local-runs'
import { findManifest, readSystemMap } from './devops-system-map'
import { LAUNCHPAD_TOOLS } from '../../../shared/fork-devops-launchpad'
import { readDevopsSandbox, runDevopsSandbox } from './devops-sandbox'
import { readDevopsContext } from './devops-context'
import { readDevopsRadar, startDevopsRadar, stopDevopsRadar } from './devops-radar'
import type { DevopsInspection } from '../../../shared/fork-devops-inspection'

const MANIFEST_KINDS = new Set([
  'Ingress',
  'Service',
  'Deployment',
  'StatefulSet',
  'DaemonSet',
  'ConfigMap',
  'Secret'
])

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
  ipcMain.handle('aiVault:readSystemMap', async (_event, workspacePath: unknown) =>
    isLocalDirectory(workspacePath)
      ? readSystemMap(workspacePath)
      : { ok: false, error: 'The system map needs a local workspace.' }
  )
  ipcMain.handle('aiVault:findManifest', async (_event, request: unknown) => {
    const field = (key: string): unknown =>
      request && typeof request === 'object' ? Reflect.get(request, key) : null
    const workspacePath = field('workspacePath')
    const kind = field('kind')
    const name = field('name')
    return isLocalDirectory(workspacePath) &&
      typeof kind === 'string' &&
      MANIFEST_KINDS.has(kind) &&
      typeof name === 'string' &&
      /^[a-z0-9][a-z0-9.-]{0,252}$/.test(name)
      ? findManifest(workspacePath, kind, name)
      : null
  })
  ipcMain.handle('aiVault:listLocalRuns', async (_event, workspacePath: unknown) =>
    isLocalDirectory(workspacePath) ? listLocalRuns(workspacePath) : []
  )
  // Only the Launchpad's own tool names reach the shell lookup.
  ipcMain.handle('aiVault:checkLaunchpadTools', async (_event, workspacePath: unknown) => {
    if (!isLocalDirectory(workspacePath)) {
      return {}
    }
    const usesMise = MISE_FILES.some((name) => existsSync(join(workspacePath, name)))
    const statuses = await Promise.all(
      LAUNCHPAD_TOOLS.map((tool) => resolveTool(workspacePath, tool, usesMise))
    )
    return Object.fromEntries(statuses.map((status) => [status.tool, status]))
  })
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

/** Fork B1: start, stop and read a workspace's Radar cluster view. */
export function registerDevopsRadarHandlers(): void {
  ipcMain.handle('aiVault:readDevopsRadar', (_event, workspacePath: unknown) =>
    isLocalDirectory(workspacePath) ? readDevopsRadar(workspacePath) : { ok: true }
  )
  ipcMain.handle('aiVault:runDevopsRadar', async (_event, request: unknown) => {
    const workspacePath: unknown =
      request && typeof request === 'object' ? Reflect.get(request, 'workspacePath') : null
    const action: unknown =
      request && typeof request === 'object' ? Reflect.get(request, 'action') : null
    if (!isLocalDirectory(workspacePath)) {
      return { ok: false, error: 'Not a local workspace.' }
    }
    return action === 'stop' ? stopDevopsRadar(workspacePath) : startDevopsRadar(workspacePath)
  })
}
