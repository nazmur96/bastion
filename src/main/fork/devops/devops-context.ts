import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, isAbsolute, join, normalize } from 'node:path'
import {
  devopsTone,
  parseAwsRegion,
  parseKubeContext,
  type DevopsContext
} from '../../../shared/fork-devops-context'
import { sandboxClusterContext } from '../../../shared/fork-devops-sandbox'
import { readDevopsSandbox } from './devops-sandbox'
import { MISE_FILES, run } from './devops-inspect'

const ENV_TTL_MS = 60_000
const envCache = new Map<string, { at: number; env: Record<string, string> }>()

function read(path: string): string | null {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

/** The repo's own mise env (per-repo KUBECONFIG, AWS_PROFILE…), which its commands really use. */
export async function workspaceEnv(workspacePath: string): Promise<Record<string, string>> {
  if (!MISE_FILES.some((name) => existsSync(join(workspacePath, name)))) {
    return {}
  }
  const hit = envCache.get(workspacePath)
  if (hit && Date.now() - hit.at < ENV_TTL_MS) {
    return hit.env
  }
  const result = await run('mise', ['env', '--json'], workspacePath, 15_000)
  let env: Record<string, string> = {}
  try {
    const parsed: unknown = result.ok ? JSON.parse(result.stdout) : {}
    if (parsed && typeof parsed === 'object') {
      env = Object.fromEntries(
        Object.entries(parsed).filter(
          (entry): entry is [string, string] => typeof entry[1] === 'string'
        )
      )
    }
  } catch {
    env = {}
  }
  envCache.set(workspacePath, { at: Date.now(), env })
  return env
}

function kubeconfigPath(env: Record<string, string | undefined>): string {
  return env.KUBECONFIG?.split(delimiter).find(Boolean) ?? join(homedir(), '.kube', 'config')
}

/** Config files and the repo's mise env, no other CLI: cheap enough to poll, nothing to install. */
export async function readDevopsContext(
  workspacePath: string,
  terraformDir: string | null
): Promise<DevopsContext> {
  const context: DevopsContext = {}
  const env = { ...process.env, ...(await workspaceEnv(workspacePath)) }
  const sandbox = readDevopsSandbox(workspacePath)
  const kube = parseKubeContext(read(kubeconfigPath(env)) ?? '')
  if (kube) {
    const local =
      kube.context === sandboxClusterContext(sandbox.cluster?.name ?? '') ||
      /^(kind-|vcluster-docker_|k3d-|minikube$|docker-desktop$)/.test(kube.context)
    context.kube = { ...kube, tone: devopsTone(kube.context, local) }
  }
  if (sandbox.awsEnv) {
    const region = sandbox.awsEnv.AWS_REGION ?? sandbox.awsEnv.AWS_DEFAULT_REGION
    context.aws = { profile: 'floci', ...(region ? { region } : {}), tone: 'local' }
  } else {
    const profile = env.AWS_PROFILE ?? 'default'
    const region =
      env.AWS_REGION ??
      env.AWS_DEFAULT_REGION ??
      parseAwsRegion(read(join(homedir(), '.aws', 'config')) ?? '', profile)
    context.aws = { profile, ...(region ? { region } : {}), tone: devopsTone(profile) }
  }
  if (terraformDir !== null) {
    const dir = normalize(terraformDir)
    if (!isAbsolute(dir) && !dir.startsWith('..')) {
      const root = join(workspacePath, dir)
      const workspace =
        read(join(root, '.terraform', 'environment'))?.trim() ||
        (existsSync(join(root, '.terraform')) ? 'default' : null)
      if (workspace) {
        context.terraform = { workspace, tone: devopsTone(workspace) }
      }
    }
  }
  return context
}
