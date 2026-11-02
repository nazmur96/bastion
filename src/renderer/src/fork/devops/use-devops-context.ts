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
  const path = useAppStore((state) => selectKnownWorktreeById(state, worktreeId)?.path)
  const [context, setContext] = useState<DevopsContext>({})
  useEffect(() => {
    if (!path) {
      return
    }
    let current = true
    const load = (): void => {
      void window.api.aiVault
        .readDevopsContext({ workspacePath: path, terraformDir })
        .then((next) => {
          if (current) {
            setContext(next)
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
  }, [path, terraformDir, refreshKey])
  return context
}
