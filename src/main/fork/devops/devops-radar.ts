import { app } from 'electron'
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, sep } from 'node:path'
import { MISE_FILES, resolveTool } from './devops-inspect'
import { workspaceEnv } from './devops-context'
import type { DevopsRadarResult } from '../../../shared/fork-devops-radar'
import { freeLocalPort } from './devops-ports'

const RADAR = 'kubectl-radar'
const FIRST_PORT = 9280
const READY_TIMEOUT_MS = 45_000

const running = new Map<string, { child: ChildProcess; url: string }>()
let quitHooked = false

async function waitUntilServing(url: string, child: ChildProcess): Promise<boolean> {
  const deadline = Date.now() + READY_TIMEOUT_MS
  while (Date.now() < deadline && child.exitCode === null) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2_000) })
      if (response.status < 500) {
        return true
      }
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  return false
}

export function readDevopsRadar(workspacePath: string): DevopsRadarResult {
  const entry = running.get(workspacePath)
  return entry ? { ok: true, url: entry.url } : { ok: true }
}

/** B1: Radar's read-only MCP endpoint for a Claude chat started inside a workspace that runs it. */
export function devopsRadarMcpFor(cwd: string): string | null {
  for (const [path, entry] of running) {
    if (cwd === path || cwd.startsWith(`${path}${sep}`)) {
      return `${entry.url}/mcp-readonly`
    }
  }
  return null
}

export function stopDevopsRadar(workspacePath: string): DevopsRadarResult {
  running.get(workspacePath)?.child.kill()
  running.delete(workspacePath)
  return { ok: true }
}

/** One Radar per workspace, on its own port, seeing the cluster the repo's own kubeconfig points at. */
export async function startDevopsRadar(workspacePath: string): Promise<DevopsRadarResult> {
  const existing = running.get(workspacePath)
  if (existing) {
    return { ok: true, url: existing.url }
  }
  const usesMise = MISE_FILES.some((name) => existsSync(join(workspacePath, name)))
  const status = await resolveTool(workspacePath, RADAR, usesMise)
  if (!status.available) {
    return {
      ok: false,
      error: usesMise
        ? 'Radar is not in this repo yet: mise use github:skyhook-io/radar'
        : 'Install Radar (radarhq.io) so kubectl-radar is on your PATH.'
    }
  }
  const env = { ...process.env, ...(await workspaceEnv(workspacePath)) }
  const port = await freeLocalPort(FIRST_PORT)
  const kubeconfig = env.KUBECONFIG?.split(process.platform === 'win32' ? ';' : ':')[0]
  const args = [
    '--no-browser',
    '--port',
    String(port),
    '--mcp-read-only',
    ...(kubeconfig ? ['--kubeconfig', kubeconfig] : [])
  ]
  const child =
    status.runner === 'mise'
      ? spawn('mise', ['exec', '--', RADAR, ...args], { cwd: workspacePath, env, stdio: 'ignore' })
      : spawn(RADAR, args, { cwd: workspacePath, env, stdio: 'ignore' })
  const url = `http://127.0.0.1:${port}`
  child.once('exit', () => {
    if (running.get(workspacePath)?.child === child) {
      running.delete(workspacePath)
    }
  })
  if (!quitHooked) {
    quitHooked = true
    app.on('before-quit', () => {
      for (const entry of running.values()) {
        entry.child.kill()
      }
      running.clear()
    })
  }
  running.set(workspacePath, { child, url })
  if (!(await waitUntilServing(url, child))) {
    stopDevopsRadar(workspacePath)
    return {
      ok: false,
      error: 'Radar did not start. Check that this workspace’s kube context reaches a cluster.'
    }
  }
  return { ok: true, url }
}
