import type { DevopsStackFinding } from './fork-devops-stacks'

/** Fork, path step 2: one project may be one repo or sibling app / GitOps / platform repos. */
export type ProjectRole = 'app' | 'gitops' | 'platform'

export type ProjectRepo = {
  path: string
  folder: string
  remote: string | null
  usesMise: boolean
  findings: DevopsStackFinding[]
}

export type ProjectMember = { repo: ProjectRepo; role: ProjectRole }

const ROLE_WORDS: Record<Exclude<ProjectRole, 'app'>, RegExp> = {
  gitops: /(^|[-_.])(gitops|deploy|deployments|manifests|k8s|argocd|flux)([-_.]|$)/i,
  platform: /(^|[-_.])(platform|infra|infrastructure|terraform|tf|iac|cloud)([-_.]|$)/i
}

const ROLE_SUFFIX =
  /[-_.](app|service|api|gitops|deploy|deployments|manifests|k8s|argocd|flux|platform|infra|infrastructure|terraform|tf|iac|cloud)$/i

const BARE_ROLE =
  /^(gitops|deploy|deployments|manifests|k8s|argocd|flux|platform|infra|infrastructure|terraform|tf|iac|cloud)$/i

/** `shop-gitops`, `shop_infra` → `shop`; a folder that is only a role word has no base. */
export function projectBase(folder: string): string | null {
  const lower = folder.toLowerCase()
  return BARE_ROLE.test(lower) ? null : lower.replace(ROLE_SUFFIX, '') || null
}

function has(repo: ProjectRepo, ...stacks: string[]): boolean {
  return repo.findings.some((finding) => stacks.includes(finding.stack))
}

export function projectRole(repo: ProjectRepo): ProjectRole {
  if (ROLE_WORDS.gitops.test(repo.folder)) {
    return 'gitops'
  }
  if (ROLE_WORDS.platform.test(repo.folder)) {
    return 'platform'
  }
  if (has(repo, 'terraform') && !has(repo, 'containers', 'kubernetes', 'helm')) {
    return 'platform'
  }
  if (has(repo, 'argocd') && !has(repo, 'containers')) {
    return 'gitops'
  }
  return 'app'
}

/** From a bare `platform` repo: the one base name that appears in more than one role. */
function inferredBase(siblings: readonly ProjectRepo[]): string | null {
  const roles = new Map<string, Set<ProjectRole>>()
  for (const repo of siblings) {
    const base = projectBase(repo.folder)
    if (base !== null) {
      roles.set(base, (roles.get(base) ?? new Set()).add(projectRole(repo)))
    }
  }
  const shared = [...roles].filter(([, set]) => set.size > 1).map(([base]) => base)
  return shared.length === 1 ? shared[0] : null
}

/**
 * The siblings that belong with the open repo: same base name (`shop`, `shop-gitops`),
 * or a bare role-named folder (`platform`, `gitops`) next to it. At most one per role;
 * the person confirms before anything uses it.
 */
export function proposeProject(
  current: ProjectRepo,
  siblings: readonly ProjectRepo[]
): ProjectMember[] {
  const base = projectBase(current.folder) ?? inferredBase(siblings)
  const currentRole = projectRole(current)
  const members: ProjectMember[] = [{ repo: current, role: currentRole }]
  for (const repo of siblings) {
    const siblingBase = projectBase(repo.folder)
    const related = siblingBase === null || (base !== null && siblingBase === base)
    const role = projectRole(repo)
    if (related && !members.some((member) => member.role === role)) {
      members.push({ repo, role })
    }
  }
  return members
}

/** The app's Kubernetes-safe name, shared by namespaces, images and Argo apps. */
export function projectAppName(folder: string): string {
  const slug = (projectBase(folder) ?? folder)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return (slug || 'app').slice(0, 53)
}
