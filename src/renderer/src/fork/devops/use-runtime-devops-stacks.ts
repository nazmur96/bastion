import { useCallback, useEffect, useState } from 'react'
import { useAppStore } from '@/store'
import { startWorkspaceHost } from '../workbench/start-project-actions'
import { readRuntimeDevopsStacks, type RuntimeDevopsStacks } from './runtime-devops-stacks'

type Result = { id: string; hostId: string } & ({ data: RuntimeDevopsStacks } | { error: string })

/** Stacks of a project on a non-local owner; results from a previous owner are discarded. */
export function useRuntimeDevopsStacks(worktreeId: string): {
  hostId: ReturnType<typeof startWorkspaceHost>
  result: { data: RuntimeDevopsStacks } | { error: string } | null
  refresh: () => void
} {
  const hostId = useAppStore(() => startWorkspaceHost(worktreeId))
  const [result, setResult] = useState<Result | null>(null)
  const [generation, setGeneration] = useState(0)
  useEffect(() => {
    if (hostId === 'local') {
      return
    }
    let live = true
    void readRuntimeDevopsStacks(worktreeId)
      .then((data) => live && setResult({ id: worktreeId, hostId, data }))
      .catch(
        (error: unknown) =>
          live &&
          setResult({
            id: worktreeId,
            hostId,
            error: error instanceof Error ? error.message : String(error)
          })
      )
    return () => {
      live = false
    }
  }, [worktreeId, hostId, generation])
  const refresh = useCallback(() => setGeneration((value) => value + 1), [])
  const current = result?.id === worktreeId && result.hostId === hostId ? result : null
  return { hostId, result: current, refresh }
}
