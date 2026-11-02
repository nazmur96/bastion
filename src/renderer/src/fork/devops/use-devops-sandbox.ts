import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { useAppStore } from '@/store'
import { selectKnownWorktreeById } from '@/store/selectors'
import { translate } from '@/i18n/i18n'
import type {
  DevopsSandboxKind,
  DevopsSandboxRequest,
  DevopsSandboxState
} from '../../../../shared/fork-devops-sandbox'

export type DevopsSandbox = {
  state: DevopsSandboxState
  busy: DevopsSandboxKind | null
  run: (kind: DevopsSandboxKind, action: DevopsSandboxRequest['action']) => void
}

/** F4: the workspace's Floci / vind state; lifecycle calls report through toasts. */
export function useDevopsSandbox(worktreeId: string): DevopsSandbox {
  const path = useAppStore((state) => selectKnownWorktreeById(state, worktreeId)?.path)
  const [state, setState] = useState<DevopsSandboxState>({})
  const [busy, setBusy] = useState<DevopsSandboxKind | null>(null)
  useEffect(() => {
    if (!path) {
      return
    }
    let current = true
    void window.api.aiVault.readDevopsSandbox(path).then((next) => {
      if (current) {
        setState(next)
      }
    })
    return () => {
      current = false
    }
  }, [path])
  const run = useCallback(
    (kind: DevopsSandboxKind, action: DevopsSandboxRequest['action']) => {
      if (!path || busy) {
        return
      }
      setBusy(kind)
      const pending = toast.loading(
        kind === 'aws'
          ? translate('components.devops.sandbox.awsWorking', 'Local AWS (Floci): {{action}}…', {
              action
            })
          : translate(
              'components.devops.sandbox.clusterWorking',
              'Local cluster (vind): {{action}}…',
              {
                action
              }
            )
      )
      void window.api.aiVault
        .runDevopsSandbox({ workspacePath: path, kind, action })
        .then((result) => {
          setState(result.state)
          if (result.ok) {
            toast.success(translate('components.devops.sandbox.done', 'Done.'), { id: pending })
          } else {
            toast.error(result.error, { id: pending, duration: 12_000 })
          }
        })
        .finally(() => setBusy(null))
    },
    [busy, path]
  )
  return { state, busy, run }
}
