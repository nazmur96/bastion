import { realpathSync } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { splitOpenCodeSqliteCandidate } from '../../../shared/opencode-sqlite-session-path'

/** The legacy namespace retains host history; new workspaces only discover their own transcripts. */
export function isOwnedWorkspaceHistoryPath(
  candidate: string,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  const root = env.BASTION_PROJECT_WORKSPACE_DATA_ROOT
  if (!root) {
    return true
  }
  const path =
    splitOpenCodeSqliteCandidate(candidate)?.dbPath ??
    splitOpenCodeSqliteCandidate(candidate, 'zcode')?.dbPath ??
    candidate
  const contains = (parent: string, child: string): boolean => {
    const suffix = relative(resolve(parent), resolve(child))
    return (
      suffix === '' || (!isAbsolute(suffix) && suffix !== '..' && !suffix.startsWith(`..${sep}`))
    )
  }
  // Reject foreign and WSL paths before any filesystem access.
  if (!isAbsolute(path) || !contains(root, path)) {
    return false
  }
  try {
    return contains(realpathSync(root), realpathSync(path))
  } catch {
    return false
  }
}
