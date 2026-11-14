import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { runInWorkbenchTerminal } from '../workbench/workbench-terminals'
import type { DevopsContext } from '../../../../shared/fork-devops-context'

export type FlociTarget = {
  /** The project's selected emulated target, when one is selected. */
  cloudTarget?: { projectId: string; targetId: string }
  /** Its sealed environment, only while the instance is ready. */
  env?: Record<string, string>
}

/**
 * The project's selected Floci target and, while it is ready, its environment as resolved by
 * main. Re-read when Cloud changes; the resolver never notifies, so this cannot loop.
 */
export function useFlociTarget(projectId: string): FlociTarget {
  const [target, setTarget] = useState<FlociTarget>({})
  useEffect(() => {
    const api = window.api.cloudTargets
    if (!api?.targetEnv) {
      return
    }
    let live = true
    const load = async (): Promise<void> => {
      const read = await api.read(projectId)
      const targetId = read.ok ? read.snapshot.selection?.targetId : null
      const selected = read.ok ? read.snapshot.targets.find((t) => t.id === targetId) : undefined
      if (!targetId || selected?.configuration.kind !== 'emulated') {
        if (live) {
          setTarget({})
        }
        return
      }
      const cloudTarget = { projectId, targetId }
      const env = await api.targetEnv?.(cloudTarget)
      if (live) {
        setTarget(env?.ok ? { cloudTarget, env: env.env } : { cloudTarget })
      }
    }
    void load().catch(() => live && setTarget({}))
    const stop = api.onChanged(() => void load().catch(() => live && setTarget({})))
    return () => {
      live = false
      stop()
    }
  }, [projectId])
  return target
}

/**
 * Runs a cloud-facing command in a workbench terminal. With an emulated target selected but not
 * running, it refuses rather than running against the engineer's real cloud configuration.
 */
export function runTargetedCommand(
  worktreeId: string,
  command: string,
  floci: FlociTarget | undefined
): void {
  if (floci?.cloudTarget && !floci.env) {
    toast.error(
      translate(
        'components.devops.floci.notRunning',
        'The selected Floci target is not running. Start it in Cloud, or clear the selection.'
      )
    )
    return
  }
  runInWorkbenchTerminal(worktreeId, command, floci?.env)
}

/** While a ready Floci target is selected, AWS commands land on it, so show that context. */
export function withFlociContext(context: DevopsContext, floci: FlociTarget): DevopsContext {
  if (!floci.env) {
    return context
  }
  const region = floci.env.AWS_REGION
  return { ...context, aws: { profile: 'floci', ...(region ? { region } : {}), tone: 'local' } }
}
