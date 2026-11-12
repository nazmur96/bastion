import { useCallback, useEffect, useState } from 'react'
import { useAppStore } from '@/store'
import { startWorkspaceHost } from '../workbench/start-project-actions'
import { captureProjectFileRoute } from '../environments/workspace-environment-files'
import { subscribeRuntimeFileChanges } from '@/runtime/runtime-file-watch-client'
import { readProjectDiscovery, type ProjectDiscovery } from './read-project-discovery'

type State = {
  key: string
  data?: ProjectDiscovery
  error?: string
  stale: boolean
  pending: boolean
}
const retained = new Map<string, State>()
export function useProjectDiscovery(worktreeId: string) {
  const host = useAppStore(() => startWorkspaceHost(worktreeId))
  const root = useAppStore((s) => s.getKnownWorktreeById(worktreeId)?.path)
  const key = JSON.stringify([worktreeId, host, root])
  const [generation, setGeneration] = useState(0)
  const [state, setState] = useState<State | null>(null)
  useEffect(() => {
    let live = true
    let changes = 0
    let watchFailed = false
    let unsubscribe: (() => void) | undefined
    const update = (next: State): void => {
      if (live) {
        retained.delete(key)
        retained.set(key, next)
        if (retained.size > 16) {
          const oldest = retained.keys().next().value
          if (oldest) {
            retained.delete(oldest)
          }
        }
        setState(next)
      }
    }
    const invalidate = (): void => {
      changes++
      setState((current) => (current?.key === key ? { ...current, stale: true } : current))
    }
    const failWatch = (): void => {
      watchFailed = true
      invalidate()
    }
    const previous = retained.get(key)
    update({ key, data: previous?.data, stale: true, pending: true })
    try {
      const { context } = captureProjectFileRoute(worktreeId)
      void subscribeRuntimeFileChanges(
        context,
        (payload) => {
          if (
            payload.worktreePath === context.worktreePath &&
            payload.connectionId === context.connectionId
          ) {
            invalidate()
          }
        },
        failWatch
      )
        .then((stop) => {
          if (live) {
            unsubscribe = stop
          } else {
            stop()
          }
        })
        .catch(failWatch)
    } catch {
      failWatch()
    }
    const expiry = window.setInterval(invalidate, 30_000)
    window.addEventListener('focus', invalidate)
    const start = changes
    void readProjectDiscovery(worktreeId)
      .then((data) =>
        update({ key, data, stale: watchFailed || changes !== start, pending: false })
      )
      .catch((error: unknown) =>
        update({
          key,
          data: previous?.data,
          stale: true,
          pending: false,
          error: error instanceof Error ? error.message : String(error)
        })
      )
    return () => {
      live = false
      window.clearInterval(expiry)
      unsubscribe?.()
      window.removeEventListener('focus', invalidate)
    }
  }, [worktreeId, key, generation])
  const refresh = useCallback(() => setGeneration((n) => n + 1), [])
  return { state: state?.key === key ? state : null, refresh }
}
