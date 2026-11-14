import { getAppEnvironment } from '../../../shared/app-environment'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { dirname, join } from 'node:path'
import { MISE_FILES, resolveTool, run } from './devops-inspect'
import {
  SANDBOX_TOOL_HINTS,
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
  return join(getAppEnvironment().getPath('userData'), 'fork-devops-sandbox.json')
}

function writeStore(all: Record<string, DevopsSandboxState>): void {
  const path = storePath()
  mkdirSync(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.tmp`
  writeFileSync(temporary, `${JSON.stringify(all, null, 2)}\n`, { mode: 0o600 })
  renameSync(temporary, path)
}

/**
 * Cluster state only. Older versions also kept local AWS endpoints and credentials here, keyed by
 * folder path for one machine-wide emulator; those fields are dropped on first read and never
 * reused. Local AWS now runs as a workspace Floci target in Cloud Connections.
 */
function load(): Record<string, DevopsSandboxState> {
  if (states) {
    return states
  }
  states = {}
  const path = storePath()
  if (!existsSync(path)) {
    return states
  }
  const stat = lstatSync(path)
  if (!stat.isFile() || stat.isSymbolicLink()) {
    return states
  }
  let legacy = false
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
    for (const [workspacePath, value] of Object.entries(
      parsed && typeof parsed === 'object' ? parsed : {}
    )) {
      const cluster: unknown =
        value && typeof value === 'object' ? Reflect.get(value, 'cluster') : undefined
      legacy ||= Boolean(value && typeof value === 'object' && 'awsEnv' in value)
      if (
        cluster &&
        typeof cluster === 'object' &&
        typeof Reflect.get(cluster, 'name') === 'string' &&
        typeof Reflect.get(cluster, 'context') === 'string' &&
        typeof Reflect.get(cluster, 'paused') === 'boolean'
      ) {
        states[workspacePath] = {
          cluster: {
            name: Reflect.get(cluster, 'name'),
            context: Reflect.get(cluster, 'context'),
            paused: Reflect.get(cluster, 'paused')
          }
        }
      }
    }
  } catch {
    legacy = true
  }
  if (legacy) {
    writeStore(states)
    // The old sealed AWS config held no secrets, but it only served the retired path.
    rmSync(join(getAppEnvironment().getPath('userData'), 'fork-floci-aws-config'), { force: true })
  }
  return states
}

function save(workspacePath: string, state: DevopsSandboxState): DevopsSandboxState {
  const all = load()
  if (state.cluster) {
    all[workspacePath] = { cluster: state.cluster }
  } else {
    delete all[workspacePath]
  }
  writeStore(all)
  return state
}

export function readDevopsSandbox(workspacePath: string): DevopsSandboxState {
  return load()[workspacePath] ?? {}
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
    // Path-only requests cannot identify a workspace target or prove its owner.
    return {
      ok: false,
      state,
      error: 'Local AWS now runs as a private Floci target. Open Cloud to add and start one.'
    }
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
