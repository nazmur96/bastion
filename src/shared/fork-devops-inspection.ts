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
