import { useEffect, useState } from 'react'
import type { MetricsResult } from '../../../../shared/fork-devops-metrics'

const REFRESH_MS = 15_000

/** Live usage for the Metrics lens; only polls while the lens is on (path given). */
export function useWorkloadMetrics(path: string | undefined): MetricsResult | null {
  const [result, setResult] = useState<MetricsResult | null>(null)
  useEffect(() => {
    if (!path) {
      setResult(null)
      return
    }
    let current = true
    const load = (): void => {
      void window.api.aiVault.workloadMetrics(path).then((next) => {
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
  }, [path])
  return result
}
