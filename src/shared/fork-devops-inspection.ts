import type { DevopsStackFinding } from './fork-devops-stacks'

export type DevopsToolStatus =
  | { tool: string; available: true; runner: 'mise' | 'path'; prefix: string }
  | { tool: string; available: false; hint: string }

/** Fork: what the Toolbelt knows about one workspace. */
export type DevopsInspection = {
  findings: DevopsStackFinding[]
  /** Where tools are looked up: the repo's mise environment, or plain PATH. */
  environment: 'mise' | 'path'
  /** Windows terminals have no sh, so mise runs the command directly there. */
  shell: 'posix' | 'windows'
  tools: Record<string, DevopsToolStatus>
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

/** The line a workbench terminal runs: mise wraps the whole command, so `$(…)` parts get its tools too. */
export function devopsCommandLine(
  status: DevopsToolStatus | undefined,
  command: string,
  shell: DevopsInspection['shell'] = 'posix'
): string {
  if (!status?.available || status.runner !== 'mise') {
    return command
  }
  return shell === 'windows'
    ? `mise exec -- ${command}`
    : `mise exec -- sh -c ${shellQuote(command)}`
}

/** How to pin a Toolbelt CLI in a repo's mise.toml; tools without an entry get an install hint only. */
export const MISE_TOOL_SPECS: Readonly<Record<string, string>> = {
  terraform: 'terraform',
  kubectl: 'kubectl',
  helm: 'helm',
  argocd: 'argocd',
  aws: 'aws-cli',
  gh: 'gh',
  'ansible-lint': 'pipx:ansible-lint',
  floci: 'github:floci-io/floci-cli',
  vcluster: 'vcluster',
  'kubectl-radar': 'github:skyhook-io/radar'
}
