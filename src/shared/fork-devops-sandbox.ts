/** Fork F4: a workspace's local Kubernetes sandbox (vind). Local AWS is a Floci cloud target. */
export type DevopsSandboxKind = 'aws' | 'cluster'

export type DevopsSandboxState = {
  /** The vind cluster this workspace started, while it exists. */
  cluster?: { name: string; context: string; paused: boolean }
}

export type DevopsSandboxResult =
  | { ok: true; state: DevopsSandboxState }
  | { ok: false; error: string; state: DevopsSandboxState }

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
  aws: 'Local AWS runs as a private Floci target. Open Cloud to add and start one.',
  cluster: 'Add vind to the repo: mise use vcluster (needs Docker).'
}

export type DevopsSandboxRequest = {
  workspacePath: string
  kind: DevopsSandboxKind
  action: 'start' | 'stop' | 'pause' | 'resume'
}
