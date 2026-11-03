import { useCallback, useEffect, useState } from 'react'

/** The platform's `terraform output` values (read-only), refreshed on demand after an apply. */
export function useTerraformOutputs(
  repo: string | undefined,
  dir: string | null
): { outputs: Record<string, string>; refresh: () => void } {
  const [outputs, setOutputs] = useState<Record<string, string>>({})
  const [round, setRound] = useState(0)
  useEffect(() => {
    if (!repo || dir === null) {
      return
    }
    let current = true
    void window.api.aiVault.terraformOutputs({ workspacePath: repo, dir }).then((next) => {
      if (current) {
        setOutputs('error' in next ? {} : next)
      }
    })
    return () => {
      current = false
    }
  }, [repo, dir, round])
  return { outputs, refresh: useCallback(() => setRound((value) => value + 1), []) }
}
