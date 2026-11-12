import { getKnownExecutionHostIdForWorktree } from '@/lib/worktree-runtime-owner'
import { useEffect, useState } from 'react'
import { useAppStore } from '@/store'
import { selectKnownWorktreeById } from '@/store/selectors'
import type { DevopsContext } from '../../../../shared/fork-devops-context'

const REFRESH_MS = 10_000

/** A1: kube context, AWS profile and Terraform workspace, re-read every 10 s and on focus. */
export function useDevopsContext(
  worktreeId: string,
  terraformDir: string | null,
  refreshKey: string
): DevopsContext {
  const local = useAppStore(
    (state) => getKnownExecutionHostIdForWorktree(state, worktreeId) === 'local'
  )
  const path = useAppStore((state) => selectKnownWorktreeById(state, worktreeId)?.path)
  const [result, setResult] = useState<{
    path: string
    terraformDir: string | null
    context: DevopsContext
  } | null>(null)
  useEffect(() => {
    if (!path || !local) {
      return
    }
    let current = true
    const load = (): void => {
      void window.api.aiVault
        .readDevopsContext({ workspacePath: path, terraformDir })
        .then((next) => {
          if (current) {
            setResult({ path, terraformDir, context: next })
          }
        })
    }
    load()
    const timer = window.setInterval(load, REFRESH_MS)
    window.addEventListener('focus', load)
    return () => {
      current = false
      window.clearInterval(timer)
      window.removeEventListener('focus', load)
    }
  }, [path, local, terraformDir, refreshKey])
  return local && result && result.path === path && result.terraformDir === terraformDir
    ? result.context
    : {}
}
