import { useCallback, useEffect, useState } from 'react'
import { useAppStore } from '@/store'
import { selectKnownWorktreeById } from '@/store/selectors'
import {
  proposeProject,
  type ProjectMember,
  type ProjectRepo,
  type ProjectRole
} from '../../../../shared/fork-devops-project'

const KEY = 'orca-fork.project.v1'

type Decision = { kind: 'confirmed'; paths: string[] } | { kind: 'single' }

function isDecision(value: unknown): value is Decision {
  if (value === null || typeof value !== 'object') {
    return false
  }
  const kind: unknown = Reflect.get(value, 'kind')
  const paths: unknown = Reflect.get(value, 'paths')
  return (
    kind === 'single' ||
    (kind === 'confirmed' &&
      Array.isArray(paths) &&
      paths.every((path) => typeof path === 'string'))
  )
}

function readDecisions(): Record<string, Decision> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}')
    return parsed !== null && typeof parsed === 'object'
      ? Object.fromEntries(
          Object.entries(parsed).filter((entry): entry is [string, Decision] =>
            isDecision(entry[1])
          )
        )
      : {}
  } catch {
    return {}
  }
}

function writeDecision(path: string, decision: Decision | null): void {
  try {
    const all = readDecisions()
    if (decision) {
      all[path] = decision
    } else {
      delete all[path]
    }
    localStorage.setItem(KEY, JSON.stringify(all))
  } catch {
    // Storage off: the proposal is simply asked again next time.
  }
}

export type DevopsProject = {
  /** What the IDE thinks belongs together; the first member is the open repo. */
  proposal: ProjectMember[]
  /** null until the person answers (only asked when there is more than one repo). */
  decision: Decision | null
  /** The repos stages actually use: confirmed members, or just the open repo. */
  members: ProjectMember[]
  repoFor: (role: ProjectRole) => ProjectRepo | null
  confirm: () => void
  keepSingle: () => void
  reset: () => void
}

/** Path step 2: one repo or sibling app / GitOps / platform repos, confirmed once per repo. */
export function useDevopsProject(worktreeId: string): DevopsProject | null {
  const path = useAppStore((state) => selectKnownWorktreeById(state, worktreeId)?.path)
  const [proposal, setProposal] = useState<ProjectMember[] | null>(null)
  const [decision, setDecision] = useState<Decision | null>(null)
  useEffect(() => {
    if (!path) {
      return
    }
    setDecision(readDecisions()[path] ?? null)
    let current = true
    void window.api.aiVault.projectRepos(path).then((repos) => {
      if (current && repos) {
        setProposal(proposeProject(repos.current, repos.siblings))
      }
    })
    return () => {
      current = false
    }
  }, [path])
  const decide = useCallback(
    (next: Decision | null) => {
      if (path) {
        writeDecision(path, next)
        setDecision(next)
      }
    },
    [path]
  )
  if (!proposal || !path) {
    return null
  }
  const members =
    decision?.kind === 'confirmed'
      ? proposal.filter((member, index) => index === 0 || decision.paths.includes(member.repo.path))
      : proposal.slice(0, 1)
  return {
    proposal,
    decision,
    members,
    repoFor: (role) => members.find((member) => member.role === role)?.repo ?? null,
    confirm: () => decide({ kind: 'confirmed', paths: proposal.map((member) => member.repo.path) }),
    keepSingle: () => decide({ kind: 'single' }),
    reset: () => decide(null)
  }
}
