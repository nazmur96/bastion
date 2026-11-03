import { existsSync, readdirSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { MISE_FILES, findDevopsStacks, run } from './devops-inspect'
import { projectBase, type ProjectRepo } from '../../../shared/fork-devops-project'

const SIBLING_LIMIT = 40

async function describeRepo(path: string): Promise<ProjectRepo> {
  const [remote, findings] = await Promise.all([
    run('git', ['remote', 'get-url', 'origin'], path),
    findDevopsStacks(path)
  ])
  return {
    path,
    folder: basename(path),
    remote: remote.ok ? remote.stdout.trim() : null,
    usesMise: MISE_FILES.some((name) => existsSync(join(path, name))),
    findings
  }
}

/**
 * The open folder plus the git repos next to it that look related by name (same base,
 * or a bare role name like `platform`). Read-only; grouping is proposed, never assumed.
 */
export async function readProjectRepos(
  workspacePath: string
): Promise<{ current: ProjectRepo; siblings: ProjectRepo[] }> {
  const parent = dirname(workspacePath)
  const base = projectBase(basename(workspacePath))
  let names: string[] = []
  try {
    names = readdirSync(parent, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && join(parent, entry.name) !== workspacePath)
      .map((entry) => entry.name)
      .slice(0, SIBLING_LIMIT)
  } catch {
    names = []
  }
  const candidates = names.filter((name) => {
    const siblingBase = projectBase(name)
    return (
      (siblingBase === null || (base !== null && siblingBase === base)) &&
      existsSync(join(parent, name, '.git'))
    )
  })
  const [current, siblings] = await Promise.all([
    describeRepo(workspacePath),
    Promise.all(candidates.map((name) => describeRepo(join(parent, name))))
  ])
  return { current, siblings }
}
