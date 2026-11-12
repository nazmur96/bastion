import { useCallback, useEffect, useState } from 'react'
import { useAppStore } from '@/store'
import { startWorkspaceHost } from '../workbench/start-project-actions'
import { captureProjectFileRoute } from '../environments/workspace-environment-files'
import { subscribeRuntimeFileChanges } from '@/runtime/runtime-file-watch-client'
import type { FsChangedPayload } from '../../../../shared/filesystem-entry-types'
import { readProjectDiscovery, type ProjectDiscovery } from './read-project-discovery'

type State = {
  key: string
  data?: ProjectDiscovery
  error?: string
  pending: boolean
  /** The source may differ from data: a change arrived, the read failed or notifications stopped. */
  stale: boolean
  /** Project-relative paths reported changed since the snapshot; null when the change is unknown. */
  changedPaths: string[] | null
  watchFailed: boolean
}
const CHANGED_PATH_LIMIT = 200
const retained = new Map<string, State>()

/** Relative paths a change touched, or null when the payload cannot say (overflow, resync). */
export function changedProjectPaths(payload: FsChangedPayload, root: string): string[] | null {
  if (payload.resync || payload.events.length === 0) {
    return null
  }
  const normalize = (path: string): string => path.replaceAll('\\', '/')
  const prefix = `${normalize(root).replace(/\/$/, '')}/`
  const paths: string[] = []
  for (const event of payload.events) {
    if (event.kind === 'overflow') {
      return null
    }
    for (const path of [event.absolutePath, event.oldAbsolutePath]) {
      const relative =
        path && normalize(path).startsWith(prefix) ? normalize(path).slice(prefix.length) : null
      // Git's own bookkeeping is not inspected source.
      if (relative && relative !== '.git' && !relative.startsWith('.git/')) {
        paths.push(relative)
      }
    }
  }
  return paths
}

export function useProjectDiscovery(worktreeId: string) {
  const host = useAppStore(() => startWorkspaceHost(worktreeId))
  const root = useAppStore((s) => s.getKnownWorktreeById(worktreeId)?.path)
  const key = JSON.stringify([worktreeId, host, root])
  const [generation, setGeneration] = useState(0)
  const [state, setState] = useState<State | null>(null)
  useEffect(() => {
    let live = true
    const changed = new Set<string>()
    let unknownChange = false
    let watchFailed = false
    let unsubscribe: (() => void) | undefined
    const freshness = (): Pick<State, 'changedPaths' | 'watchFailed'> => ({
      changedPaths: unknownChange ? null : [...changed],
      watchFailed
    })
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
    const invalidate = (paths: string[] | null): void => {
      if (paths === null) {
        unknownChange = true
      } else {
        for (const path of paths) {
          if (changed.size >= CHANGED_PATH_LIMIT) {
            unknownChange = true
            break
          }
          changed.add(path)
        }
      }
      setState((current) =>
        current?.key === key ? { ...current, stale: true, ...freshness() } : current
      )
    }
    const failWatch = (): void => {
      watchFailed = true
      invalidate(null)
    }
    const previous = retained.get(key)
    update({
      key,
      data: previous?.data,
      stale: true,
      pending: true,
      changedPaths: null,
      watchFailed
    })
    try {
      const { context } = captureProjectFileRoute(worktreeId)
      void subscribeRuntimeFileChanges(
        context,
        (payload) => {
          if (
            payload.worktreePath !== context.worktreePath ||
            payload.connectionId !== context.connectionId
          ) {
            return
          }
          const paths = changedProjectPaths(payload, context.worktreePath ?? '')
          if (paths === null || paths.length > 0) {
            invalidate(paths)
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
    void readProjectDiscovery(worktreeId)
      .then((data) =>
        update({
          key,
          data,
          pending: false,
          stale: watchFailed || unknownChange || changed.size > 0,
          ...freshness()
        })
      )
      .catch((error: unknown) =>
        update({
          key,
          data: previous?.data,
          stale: true,
          pending: false,
          ...freshness(),
          error: error instanceof Error ? error.message : String(error)
        })
      )
    return () => {
      live = false
      unsubscribe?.()
    }
  }, [worktreeId, key, generation])
  const refresh = useCallback(() => setGeneration((n) => n + 1), [])
  return { state: state?.key === key ? state : null, refresh }
}
