import { useCallback, useEffect, useState } from 'react'
import type { SystemMapResult } from '../../../../shared/fork-devops-system-map'

const REFRESH_MS = 15_000

/** One cluster read for the whole Infra home: the map draws it, the Launchpad gates demos on it. */
export function useSystemMap(
  path: string | undefined,
  contextKey: string
): {
  result: SystemMapResult | null
  refresh: () => void
} {
  const [result, setResult] = useState<SystemMapResult | null>(null)
  const [round, setRound] = useState(0)
  useEffect(() => {
    if (!path) {
      return
    }
    let current = true
    const load = (): void => {
      void window.api.aiVault.readSystemMap(path).then((next) => {
        if (current) {
          setResult(next)
        }
      })
    }
    load()
    const timer = window.setInterval(load, REFRESH_MS)
    return () => {
      current = false
      window.clearInterval(timer)
    }
  }, [path, contextKey, round])
  return { result, refresh: useCallback(() => setRound((value) => value + 1), []) }
}
