import { useCallback, useEffect, useState } from 'react'

/** The platform's `terraform output` values (read-only), refreshed on demand after an apply. */
export function useTerraformOutputs(
  repo: string | undefined,
  dir: string | null,
  cloudTarget?: { projectId: string; targetId: string }
): { outputs: Record<string, string>; refresh: () => void } {
  const [outputs, setOutputs] = useState<Record<string, string>>({})
  const [round, setRound] = useState(0)
  const projectId = cloudTarget?.projectId
  const targetId = cloudTarget?.targetId
  useEffect(() => {
    if (!repo || dir === null) {
      return
    }
    let current = true
    void window.api.aiVault
      .terraformOutputs({
        workspacePath: repo,
        dir,
        ...(projectId && targetId ? { cloudTarget: { projectId, targetId } } : {})
      })
      .then((next) => {
        if (current) {
          setOutputs('error' in next ? {} : next)
        }
      })
    return () => {
      current = false
    }
  }, [repo, dir, round, projectId, targetId])
  return { outputs, refresh: useCallback(() => setRound((value) => value + 1), []) }
}
