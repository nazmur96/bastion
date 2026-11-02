import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { MISE_FILES, resolveTool } from './devops-inspect'
import { workspaceEnv } from './devops-context'

/** kubectl as the repo runs it: its mise pin and its own KUBECONFIG. */
export async function kubectlIn(
  workspacePath: string,
  args: string[],
  timeout = 15_000
): Promise<{ ok: boolean; out: string }> {
  const usesMise = MISE_FILES.some((name) => existsSync(join(workspacePath, name)))
  const kubectl = await resolveTool(workspacePath, 'kubectl', usesMise)
  if (!kubectl.available) {
    return { ok: false, out: kubectl.hint }
  }
  const env = { ...process.env, ...(await workspaceEnv(workspacePath)) }
  const [command, argv] =
    kubectl.runner === 'mise' ? ['mise', ['exec', '--', 'kubectl', ...args]] : ['kubectl', args]
  return new Promise((resolve) => {
    execFile(
      command,
      argv,
      { cwd: workspacePath, env, timeout, maxBuffer: 16 * 1024 * 1024 },
      (error, stdout, stderr) =>
        resolve(
          error
            ? { ok: false, out: String(stderr).trim().split('\n').at(-1) || error.message }
            : { ok: true, out: String(stdout) }
        )
    )
  })
}
