import { useEffect, useState } from 'react'
import { useAppStore } from '@/store'
import { selectKnownWorktreeById } from '@/store/selectors'
import type { DevopsInspection } from '../../../../shared/fork-devops-inspection'

const REFRESH_MS = 60_000
const cache = new Map<string, { at: number; inspection: Promise<DevopsInspection> }>()

function inspect(path: string): Promise<DevopsInspection> {
  const hit = cache.get(path)
  if (hit && Date.now() - hit.at < REFRESH_MS) {
    return hit.inspection
  }
  const inspection = window.api.aiVault.inspectDevops(path).catch((): DevopsInspection => ({
    findings: [],
    environment: 'path',
    shell: 'posix',
    tools: {}
  }))
  cache.set(path, { at: Date.now(), inspection })
  return inspection
}

/** The workspace's stacks and tools, re-read at most once a minute and on window focus. */
export function useDevopsInspection(worktreeId: string): DevopsInspection | null {
  const path = useAppStore((state) => selectKnownWorktreeById(state, worktreeId)?.path)
  const [result, setResult] = useState<{ path: string; inspection: DevopsInspection } | null>(null)
  useEffect(() => {
    if (!path) {
      return
    }
    let current = true
    const load = (): void => {
      void inspect(path).then((inspection) => {
        if (current) {
          setResult({ path, inspection })
        }
      })
    }
    load()
    window.addEventListener('focus', load)
    return () => {
      current = false
      window.removeEventListener('focus', load)
    }
  }, [path])
  return result && result.path === path ? result.inspection : null
}
