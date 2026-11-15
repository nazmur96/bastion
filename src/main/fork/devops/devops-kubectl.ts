import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { MISE_FILES, resolveTool } from './devops-inspect'
import { workspaceEnv } from './devops-context'
import {
  classifyKubectlFailure,
  kubeconfigSource,
  type ClusterEvidence,
  type KubeconfigSource,
  type KubectlCode
} from '../../../shared/fork-devops-kube-evidence'

export type KubectlResult = {
  ok: boolean
  out: string
  /** Why a read failed; a failure is unknown, never an empty result. */
  code: KubectlCode
  runner: 'mise' | 'path' | null
  kubeconfig: KubeconfigSource
}

/** kubectl as the repo runs it: its mise pin and its own KUBECONFIG. */
export async function kubectlIn(
  workspacePath: string,
  args: string[],
  timeout = 15_000
): Promise<KubectlResult> {
  const usesMise = MISE_FILES.some((name) => existsSync(join(workspacePath, name)))
  const projectEnv = await workspaceEnv(workspacePath)
  const kubeconfig = kubeconfigSource(projectEnv, process.env)
  const kubectl = await resolveTool(workspacePath, 'kubectl', usesMise)
  if (!kubectl.available) {
    return { ok: false, out: kubectl.hint, code: 'tool-missing', runner: null, kubeconfig }
  }
  const runner = kubectl.runner === 'mise' ? 'mise' : 'path'
  const env = { ...process.env, ...projectEnv }
  const [command, argv] =
    runner === 'mise' ? ['mise', ['exec', '--', 'kubectl', ...args]] : ['kubectl', args]
  return new Promise((resolve) => {
    execFile(
      command,
      argv,
      { cwd: workspacePath, env, timeout, maxBuffer: 16 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (!error) {
          resolve({ ok: true, out: String(stdout), code: 'ok', runner, kubeconfig })
          return
        }
        const message = String(stderr).trim().split('\n').at(-1) || error.message
        resolve({
          ok: false,
          out: message,
          code: classifyKubectlFailure(String(stderr), Boolean(error.killed)),
          runner,
          kubeconfig
        })
      }
    )
  })
}

/**
 * Reads the current context once, so several calls of one read all target the same cluster
 * even if the kubeconfig's current-context changes meanwhile.
 */
export async function kubectlCurrentContext(
  workspacePath: string
): Promise<{ context: string | null; evidence: ClusterEvidence }> {
  const result = await kubectlIn(workspacePath, ['config', 'current-context'], 5_000)
  const context = result.ok ? result.out.trim() || null : null
  return {
    context,
    evidence: {
      status: result.ok ? (context ? 'ok' : 'no-context') : result.code,
      context,
      kubeconfig: result.kubeconfig,
      runner: result.runner
    }
  }
}
