/** Fork F4: a workspace's local sandbox — Floci for AWS, vind for Kubernetes. */
export type DevopsSandboxKind = 'aws' | 'cluster'

export type DevopsSandboxState = {
  /** `floci env` output while local AWS is on; injected into the workspace's terminals and chats. */
  awsEnv?: Record<string, string>
  /** The vind cluster this workspace started, while it exists. */
  cluster?: { name: string; context: string; paused: boolean }
}

export type DevopsSandboxResult =
  | { ok: true; state: DevopsSandboxState }
  | { ok: false; error: string; state: DevopsSandboxState }

export const FLOCI_DASHBOARD_URL = 'http://localhost:4500/console/aws'

/** `export KEY=value` / `KEY=value` lines, quotes stripped; anything else is ignored. */
export function parseShellEnv(stdout: string): Record<string, string> {
  const env: Record<string, string> = {}
  for (const raw of stdout.split('\n')) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(raw)
    if (!match) {
      continue
    }
    const value = match[2].trim()
    env[match[1]] = /^(['"]).*\1$/.test(value) ? value.slice(1, -1) : value
  }
  return env
}

/** One cluster per workspace, named after its folder; vind connects it as `vcluster-docker_<name>`. */
export function sandboxClusterName(workspacePath: string): string {
  const folder =
    workspacePath
      .replace(/[\\/]+$/, '')
      .split(/[\\/]/)
      .at(-1) ?? 'workspace'
  const slug = folder
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `${(slug || 'workspace').slice(0, 40)}-dev`
}

export function sandboxClusterContext(name: string): string {
  return `vcluster-docker_${name}`
}

/** Hints for a missing sandbox CLI, as a repo-pinned mise tool. */
export const SANDBOX_TOOL_HINTS: Record<DevopsSandboxKind, string> = {
  aws: 'Add Floci to the repo: mise use github:floci-io/floci-cli (needs Docker or Podman).',
  cluster: 'Add vind to the repo: mise use vcluster (needs Docker).'
}

export type DevopsSandboxRequest = {
  workspacePath: string
  kind: DevopsSandboxKind
  action: 'start' | 'stop' | 'pause' | 'resume'
}
