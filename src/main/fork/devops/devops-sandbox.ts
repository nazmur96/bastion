import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, sep } from 'node:path'
import { MISE_FILES, resolveTool, run } from './devops-inspect'
import {
  SANDBOX_TOOL_HINTS,
  parseShellEnv,
  sandboxClusterContext,
  sandboxClusterName,
  type DevopsSandboxKind,
  type DevopsSandboxResult,
  type DevopsSandboxState
} from '../../../shared/fork-devops-sandbox'

const LIFECYCLE_TIMEOUT_MS = 10 * 60_000
const TOOLS: Record<DevopsSandboxKind, string> = { aws: 'floci', cluster: 'vcluster' }

let states: Record<string, DevopsSandboxState> | null = null

function storePath(): string {
  return join(app.getPath('userData'), 'fork-devops-sandbox.json')
}

function load(): Record<string, DevopsSandboxState> {
  if (states) {
    return states
  }
  try {
    const parsed: unknown = JSON.parse(readFileSync(storePath(), 'utf8'))
    states = parsed && typeof parsed === 'object' ? Object.fromEntries(Object.entries(parsed)) : {}
  } catch {
    states = {}
  }
  return states
}

function save(workspacePath: string, state: DevopsSandboxState): DevopsSandboxState {
  const all = load()
  if (state.awsEnv || state.cluster) {
    all[workspacePath] = state
  } else {
    delete all[workspacePath]
  }
  mkdirSync(dirname(storePath()), { recursive: true })
  writeFileSync(storePath(), `${JSON.stringify(all, null, 2)}\n`)
  return state
}

/** Floci is one emulator per machine, so stopping it ends local AWS for every workspace. */
function forgetLocalAwsEverywhere(workspacePath: string): DevopsSandboxState {
  for (const [path, state] of Object.entries(load())) {
    if (state.awsEnv) {
      save(path, { ...state, awsEnv: undefined })
    }
  }
  return readDevopsSandbox(workspacePath)
}

export function readDevopsSandbox(workspacePath: string): DevopsSandboxState {
  return load()[workspacePath] ?? {}
}

/** Local AWS endpoints for a process started inside a sandboxed workspace (Claude chats). */
/**
 * Floci's env, sealed off from the person's real AWS setup: their ~/.aws profiles
 * (SSO, `aws login`, credential_process) must neither leak into local runs nor break
 * them, so config and credentials point at a file with only a bare default profile.
 */
function hermeticAwsEnv(awsEnv: Record<string, string>): Record<string, string> {
  if (Object.keys(awsEnv).length === 0) {
    return awsEnv
  }
  const sealed = join(app.getPath('userData'), 'fork-floci-aws-config')
  // An empty AWS_PROFILE is rejected by the CLI, so a bare default profile is selected instead.
  writeFileSync(sealed, '[default]\n')
  return {
    ...awsEnv,
    AWS_CONFIG_FILE: sealed,
    AWS_SHARED_CREDENTIALS_FILE: sealed,
    AWS_PROFILE: 'default'
  }
}

export function devopsSandboxEnvFor(cwd: string): Record<string, string> {
  const match = Object.entries(load())
    .filter(([path]) => cwd === path || cwd.startsWith(`${path}${sep}`))
    .sort((a, b) => b[0].length - a[0].length)[0]
  return match?.[1].awsEnv ?? {}
}

async function cli(
  workspacePath: string,
  kind: DevopsSandboxKind,
  args: string[],
  timeout = LIFECYCLE_TIMEOUT_MS
): Promise<{ ok: boolean; stdout: string; missing?: string }> {
  const usesMise = MISE_FILES.some((name) => existsSync(join(workspacePath, name)))
  const status = await resolveTool(workspacePath, TOOLS[kind], usesMise)
  if (!status.available) {
    return { ok: false, stdout: '', missing: SANDBOX_TOOL_HINTS[kind] }
  }
  return status.runner === 'mise'
    ? run('mise', ['exec', '--', TOOLS[kind], ...args], workspacePath, timeout)
    : run(TOOLS[kind], args, workspacePath, timeout)
}

function failed(
  state: DevopsSandboxState,
  what: string,
  out: { stdout: string; missing?: string }
) {
  const tail = out.stdout.trim().split('\n').slice(-6).join('\n')
  return {
    ok: false as const,
    state,
    error: out.missing ?? `${what} failed.${tail ? `\n${tail}` : ''}`
  }
}

export type DevopsSandboxAction = 'start' | 'stop' | 'pause' | 'resume'

/** Runs the sandbox CLI in the workspace's environment and records what is running. */
export async function runDevopsSandbox(
  workspacePath: string,
  kind: DevopsSandboxKind,
  action: DevopsSandboxAction
): Promise<DevopsSandboxResult> {
  const state = readDevopsSandbox(workspacePath)
  if (kind === 'aws') {
    if (action === 'stop') {
      const stopped = await cli(workspacePath, 'aws', ['stop'])
      // Without the CLI nothing of ours can still be running; forget the endpoints either way.
      return stopped.ok || stopped.missing !== undefined
        ? { ok: true, state: forgetLocalAwsEverywhere(workspacePath) }
        : failed(state, 'Stopping Floci', stopped)
    }
    const started = await cli(workspacePath, 'aws', ['start'])
    // One emulator serves every workspace: already running (from another one) is a start.
    if (!started.ok && !/already running/i.test(started.stdout)) {
      return failed(state, 'Starting Floci', started)
    }
    const env = await cli(workspacePath, 'aws', ['env'], 30_000)
    const awsEnv = hermeticAwsEnv(parseShellEnv(env.stdout))
    return Object.keys(awsEnv).length > 0
      ? { ok: true, state: save(workspacePath, { ...state, awsEnv }) }
      : failed(state, 'Reading `floci env`', env)
  }
  const name = state.cluster?.name ?? sandboxClusterName(workspacePath)
  const command =
    action === 'start' ? ['create', name] : action === 'stop' ? ['delete', name] : [action, name]
  if (action === 'start') {
    const driver = await cli(workspacePath, 'cluster', ['use', 'driver', 'docker'], 60_000)
    if (!driver.ok) {
      return failed(state, 'Selecting the vind (docker) driver', driver)
    }
  }
  const result = await cli(workspacePath, 'cluster', command)
  if (!result.ok) {
    return failed(state, `vcluster ${command.join(' ')}`, result)
  }
  const cluster =
    action === 'stop'
      ? undefined
      : { name, context: sandboxClusterContext(name), paused: action === 'pause' }
  return { ok: true, state: save(workspacePath, { ...state, cluster }) }
}
