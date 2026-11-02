import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { MISE_FILES, resolveTool } from './devops-inspect'
import { workspaceEnv } from './devops-context'
import {
  SYSTEM_MAP_KINDS,
  buildSystemMap,
  type SystemMapResult
} from '../../../shared/fork-devops-system-map'

const MAP_TIMEOUT_MS = 15_000

/** The cluster the repo's kubeconfig points at, read-only: one `kubectl get` across namespaces. */
export async function readSystemMap(workspacePath: string): Promise<SystemMapResult> {
  const usesMise = MISE_FILES.some((name) => existsSync(join(workspacePath, name)))
  const kubectl = await resolveTool(workspacePath, 'kubectl', usesMise)
  if (!kubectl.available) {
    return { ok: false, error: kubectl.hint }
  }
  const args = ['get', SYSTEM_MAP_KINDS, '--all-namespaces', '-o', 'json', '--request-timeout=10s']
  const [command, argv] =
    kubectl.runner === 'mise' ? ['mise', ['exec', '--', 'kubectl', ...args]] : ['kubectl', args]
  const env = { ...process.env, ...(await workspaceEnv(workspacePath)) }
  return new Promise((resolve) => {
    execFile(
      command,
      argv,
      { cwd: workspacePath, env, timeout: MAP_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          const reason = String(stderr).trim().split('\n').at(-1)
          resolve({ ok: false, error: reason || error.message })
          return
        }
        resolve({ ok: true, map: buildSystemMap(String(stdout)) })
      }
    )
  })
}
