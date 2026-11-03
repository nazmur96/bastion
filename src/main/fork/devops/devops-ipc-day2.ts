import { ipcMain } from 'electron'
import { isLocalDirectory } from './devops-ipc-guards'
import { prepareObservability, probeGrafana } from './devops-observability'
import { readRadarFindings } from './devops-radar-feed'
import { readEnvironments } from './devops-environments'
import { cancelSteps, runSteps } from './devops-step-runner'
import { addDevpodRecipe } from './devops-devpod-recipe'
import { readWorkloadMetrics } from './devops-metrics'
import { runRepoScan } from './devops-scan'
import { readCloudReadiness } from './devops-cloud'
import { readLocalDeployPlan } from './devops-local-deploy'
import { readRepoDocs, setRepoTrackerItem } from './devops-docs'

/** Fork: the project path's later stages (local run, cloud, harden, observe, environments). */
export function registerDevopsDay2Handlers(): void {
  ipcMain.handle('aiVault:repoDocs', async (_event, workspacePath: unknown) =>
    isLocalDirectory(workspacePath) ? readRepoDocs(workspacePath) : { runbooks: [], tracker: null }
  )
  ipcMain.handle('aiVault:setTrackerItem', (_event, request: unknown) => {
    const field = (key: string): unknown =>
      typeof request === 'object' && request !== null ? Reflect.get(request, key) : null
    const workspacePath = field('workspacePath')
    const file = field('file')
    const line = field('line')
    const checked = field('checked')
    return isLocalDirectory(workspacePath) &&
      typeof file === 'string' &&
      typeof line === 'number' &&
      typeof checked === 'boolean'
      ? setRepoTrackerItem(workspacePath, file, line, checked)
      : false
  })
  ipcMain.handle('aiVault:observabilityPlan', async (_event, request: unknown) => {
    const field = (key: string): unknown =>
      typeof request === 'object' && request !== null ? Reflect.get(request, key) : null
    const workspacePath = field('workspacePath')
    const namespace = field('namespace')
    return isLocalDirectory(workspacePath) &&
      typeof namespace === 'string' &&
      /^[a-z0-9][a-z0-9-]{0,62}$/.test(namespace)
      ? prepareObservability(workspacePath, namespace)
      : { ok: false, error: 'Needs a local workspace and a namespace.' }
  })
  ipcMain.handle('aiVault:probeGrafana', (_event, port: unknown) =>
    typeof port === 'number' && Number.isInteger(port) && port >= 1024 && port <= 65535
      ? probeGrafana(port)
      : false
  )
  ipcMain.handle('aiVault:radarFindings', async (_event, workspacePath: unknown) =>
    isLocalDirectory(workspacePath)
      ? readRadarFindings(workspacePath)
      : { ok: false, error: 'Needs a local workspace.' }
  )
  ipcMain.handle('aiVault:environments', async (_event, request: unknown) => {
    const field = (key: string): unknown =>
      typeof request === 'object' && request !== null ? Reflect.get(request, key) : null
    const workspacePath = field('workspacePath')
    const namespace = field('namespace')
    return isLocalDirectory(workspacePath) &&
      typeof namespace === 'string' &&
      /^[a-z0-9][a-z0-9-]{0,62}$/.test(namespace)
      ? readEnvironments(workspacePath, namespace)
      : { ok: false, error: 'Needs a local workspace and a namespace.' }
  })
  ipcMain.handle('aiVault:runSteps', (event, request: unknown) => {
    const field = (key: string): unknown =>
      typeof request === 'object' && request !== null ? Reflect.get(request, key) : null
    const runId = field('runId')
    const workspacePath = field('workspacePath')
    const steps = field('steps')
    const env = field('env')
    if (
      typeof runId !== 'string' ||
      !isLocalDirectory(workspacePath) ||
      !Array.isArray(steps) ||
      !steps.every((step) => typeof step === 'string')
    ) {
      return false
    }
    const extra =
      env && typeof env === 'object'
        ? Object.fromEntries(
            Object.entries(env).filter(
              (entry): entry is [string, string] => typeof entry[1] === 'string'
            )
          )
        : undefined
    void runSteps(event.sender, { runId, workspacePath, steps, env: extra })
    return true
  })
  ipcMain.handle('aiVault:cancelSteps', (_event, runId: unknown) => {
    if (typeof runId === 'string') {
      cancelSteps(runId)
    }
  })
  ipcMain.handle('aiVault:addDevpodRecipe', (_event, workspacePath: unknown) =>
    isLocalDirectory(workspacePath)
      ? addDevpodRecipe(workspacePath)
      : { ok: false, error: 'Needs a local workspace.' }
  )
  ipcMain.handle('aiVault:workloadMetrics', async (_event, workspacePath: unknown) =>
    isLocalDirectory(workspacePath)
      ? readWorkloadMetrics(workspacePath)
      : { ok: false, error: 'Needs a local workspace.' }
  )
  ipcMain.handle('aiVault:scanRepo', async (_event, workspacePath: unknown) =>
    isLocalDirectory(workspacePath)
      ? runRepoScan(workspacePath)
      : { ok: false, error: 'Needs a local workspace.' }
  )
  ipcMain.handle('aiVault:cloudReadiness', async (_event, workspacePath: unknown) =>
    isLocalDirectory(workspacePath)
      ? readCloudReadiness(workspacePath)
      : { error: 'Needs a local workspace.' }
  )
  ipcMain.handle('aiVault:localDeployPlan', async (_event, request: unknown) => {
    const field = (key: string): unknown =>
      typeof request === 'object' && request !== null ? Reflect.get(request, key) : null
    const appPath = field('appPath')
    const manifestsPath = field('manifestsPath')
    const clusterPath = field('clusterPath')
    return isLocalDirectory(appPath) &&
      isLocalDirectory(manifestsPath) &&
      isLocalDirectory(clusterPath)
      ? readLocalDeployPlan({ appPath, manifestsPath, clusterPath })
      : { ok: false, error: 'Running on a local cluster needs local folders.' }
  })
}
