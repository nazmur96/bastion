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
  const command = kubectl.runner === 'mise' ? 'mise' : 'kubectl'
  const prefix = kubectl.runner === 'mise' ? ['exec', '--', 'kubectl'] : []
  const env = { ...process.env, ...(await workspaceEnv(workspacePath)) }
  const kubectlRun = (extra: string[]): Promise<{ ok: boolean; out: string }> =>
    new Promise((resolve) => {
      execFile(
        command,
        [...prefix, ...extra],
        { cwd: workspacePath, env, timeout: MAP_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024 },
        (error, stdout, stderr) =>
          resolve(
            error
              ? { ok: false, out: String(stderr).trim().split('\n').at(-1) || error.message }
              : { ok: true, out: String(stdout) }
          )
      )
    })
  const [resources, secretNames] = await Promise.all([
    kubectlRun(args),
    // Names only: Secret values never leave the cluster.
    kubectlRun([
      'get',
      'secrets',
      '--all-namespaces',
      '--no-headers',
      '-o',
      'custom-columns=NS:.metadata.namespace,NAME:.metadata.name',
      '--request-timeout=10s'
    ])
  ])
  if (!resources.ok) {
    return { ok: false, error: resources.out }
  }
  const secrets = secretNames.ok
    ? new Set(
        secretNames.out
          .split(/\r?\n/)
          .map((line) => line.trim().split(/\s+/))
          .filter((parts) => parts.length === 2)
          .map(([namespace, name]) => `${namespace}/${name}`)
      )
    : null
  return { ok: true, map: buildSystemMap(resources.out, secrets) }
}
