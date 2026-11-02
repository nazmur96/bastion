import { devopsSandboxEnvFor } from './devops-sandbox'

/** The workspace's local AWS endpoints win, so a sandboxed chat never reaches the real account. */
export function withDevopsSandboxEnv(
  cwd: string,
  env: Record<string, string | undefined>
): Record<string, string | undefined> {
  const sandbox = devopsSandboxEnvFor(cwd)
  return Object.keys(sandbox).length > 0 ? { ...env, ...sandbox } : env
}
