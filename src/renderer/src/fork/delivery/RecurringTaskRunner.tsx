import { useEffect } from 'react'
import { useAppStore } from '@/store'
import type { VerificationRun } from '../../../../shared/fork-delivery/operations-contract'
import { nextDue, type RecurringTask } from '../../../../shared/fork-delivery/recurring-contract'
import { ownerOperation } from './operations-owner-client'
import { loadRecurringTasks, setRunnerState } from './recurring-tasks'

const TICK_MS = 30 * 1000

async function history(projectId: string): Promise<VerificationRun[] | null> {
  const result = await ownerOperation(projectId, 'operations.runs', { projectId }, async () =>
    window.api.cloudTargets?.operations?.runs({ projectId })
  )
  return result?.ok ? result.runs : null
}
async function runTask(projectId: string, task: RecurringTask, scheduledAt: number) {
  const request = { projectId, task: { id: task.id, scheduledAt }, request: task.request }
  return ownerOperation(projectId, 'operations.recurring', request, async () =>
    window.api.cloudTargets?.operations?.recurring(request)
  )
}

/**
 * Fork: Step 14.5. Runs the active project's enabled recurring checks while its workspace is
 * open, one at a time. Nothing runs while the workspace is closed, and nothing is backfilled:
 * the next run happens now, and the gap shows as missed on the Delivery page.
 */
export function RecurringTaskRunner(): null {
  const projectId = useAppStore((s) => s.activeWorktreeId)
  useEffect(() => {
    if (!projectId) {
      return
    }
    let stopped = false
    let busy = false
    const tick = async (): Promise<void> => {
      const tasks = loadRecurringTasks(projectId).filter((task) => task.enabled)
      if (busy || stopped || tasks.length === 0) {
        return
      }
      busy = true
      try {
        const runs = await history(projectId)
        if (!runs) {
          setRunnerState({ error: 'Run history is unavailable; recurring checks are paused.' })
          return
        }
        for (const task of tasks) {
          const due = nextDue(runs, task)
          if (stopped || Date.now() < due) {
            continue
          }
          setRunnerState({ running: task.label })
          const result = await runTask(projectId, task, due || Date.now())
          if (stopped) {
            return
          }
          setRunnerState({
            running: null,
            error: result?.ok ? null : (result?.message ?? 'Recurring checks are unavailable.'),
            revision: Date.now()
          })
          if (!result?.ok) {
            return
          }
          runs.unshift(result.run)
        }
      } finally {
        busy = false
        setRunnerState({ running: null })
      }
    }
    void tick()
    const timer = setInterval(() => void tick(), TICK_MS)
    return () => {
      stopped = true
      clearInterval(timer)
    }
  }, [projectId])
  return null
}
