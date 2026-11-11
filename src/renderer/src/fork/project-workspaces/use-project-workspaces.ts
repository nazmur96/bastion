import { useCallback, useEffect, useState } from 'react'
import {
  PROJECT_WORKSPACE_HOME_ID,
  type ProjectWorkspaceList
} from '../../../../shared/fork-project-workspaces'

// One read per window: the owning namespace never changes inside a running renderer.
let initial: Promise<ProjectWorkspaceList> | null = null
let arrivalScheduled = false

export function useProjectWorkspaces(): {
  snapshot: ProjectWorkspaceList | null
  error: string
  setSnapshot: (snapshot: ProjectWorkspaceList) => void
  refresh: () => Promise<void>
} {
  const api = window.api.projectWorkspaces
  const [snapshot, setLocalSnapshot] = useState<ProjectWorkspaceList | null>(null)
  const setSnapshot = useCallback((value: ProjectWorkspaceList) => {
    initial = Promise.resolve(value)
    setLocalSnapshot(value)
  }, [])
  const [error, setError] = useState('')
  useEffect(() => {
    if (!api) {
      return
    }
    initial ??= api.list()
    let live = true
    initial
      .then((value) => live && setLocalSnapshot(value))
      .catch((cause: unknown) => live && setError(String(cause)))
    return () => {
      live = false
    }
  }, [api])
  useEffect(() => {
    if (!snapshot || !api || arrivalScheduled) {
      return
    }
    arrivalScheduled = true
    let acknowledged = false
    const acknowledge = (): void => {
      if (!acknowledged) {
        acknowledged = true
        void api.ready?.()
      }
    }
    // Occluded desktop windows may never receive animation frames.
    const timer = setTimeout(acknowledge, 250)
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(acknowledge)
    })
    return () => {
      clearTimeout(timer)
      cancelAnimationFrame(frame)
      if (!acknowledged) {
        arrivalScheduled = false
      }
    }
  }, [api, snapshot])
  const refresh = useCallback(async () => {
    if (api) {
      setSnapshot(await api.list())
    }
  }, [api, setSnapshot])
  return { snapshot, error, setSnapshot, refresh }
}

/** 'pending' renders nothing so neither surface flashes before the owner is known. */
export function useProjectWorkspaceView(): 'pending' | 'home' | 'workspace' {
  const { snapshot, error } = useProjectWorkspaces()
  if (!window.api.projectWorkspaces || error) {
    return 'workspace'
  }
  if (!snapshot) {
    return 'pending'
  }
  return snapshot.activeId === PROJECT_WORKSPACE_HOME_ID ? 'home' : 'workspace'
}
