import { z } from 'zod'
import { backupsSchema } from './backup-contract'
import { certificatesSchema } from './certificate-contract'
import { deliveryConfigSchema } from './delivery-contract'
import { journeyCheckSchema, type VerificationRun } from './operations-contract'

/**
 * Fork: Step 14.5 recurring checks. Only the three read-only checks can be scheduled; the union
 * is closed, so a write or a paid read cannot be expressed. Each run is a real run appended to
 * the owner's history; a run missed while the workspace was closed is shown, never recorded.
 */
export const RECURRING_MIN_MINUTES = 5
export const RECURRING_MAX_TASKS = 10
const SLACK = 60 * 1000
export const recurringCheckSchema = z.discriminatedUnion('check', [
  deliveryConfigSchema
    .extend({ check: z.literal('journey'), journey: journeyCheckSchema })
    .strict(),
  certificatesSchema.extend({ check: z.literal('certificates') }).strict(),
  backupsSchema.extend({ check: z.literal('backups') }).strict()
])
export type RecurringCheck = z.infer<typeof recurringCheckSchema>
export const recurringTaskSchema = z
  .object({
    id: z.string().uuid(),
    label: z.string().min(1).max(80),
    everyMinutes: z
      .number()
      .int()
      .min(RECURRING_MIN_MINUTES)
      .max(24 * 60),
    enabled: z.boolean(),
    request: recurringCheckSchema
  })
  .strict()
export type RecurringTask = z.infer<typeof recurringTaskSchema>
export const recurringRunSchema = z
  .object({
    projectId: z.string().min(1).max(4096),
    task: z.object({ id: z.string().uuid(), scheduledAt: z.number().int().nonnegative() }).strict(),
    request: recurringCheckSchema
  })
  .strict()
export type RecurringRunRequest = z.infer<typeof recurringRunSchema>

export type MissedGap = { from: number; to: number; missed: number }
/**
 * Gaps between consecutive runs of one task (and since the last run) longer than its interval
 * allows. Derived from the real history only; nothing is ever written for a missed run.
 */
export function missedRuns(
  runs: Pick<VerificationRun, 'at' | 'task'>[],
  task: Pick<RecurringTask, 'id' | 'everyMinutes'>,
  now: number
): MissedGap[] {
  const interval = task.everyMinutes * 60 * 1000
  const times = runs
    .filter((run) => run.task?.id === task.id)
    .map((run) => run.at)
    .toSorted((a, b) => a - b)
  const gaps: MissedGap[] = []
  for (const [index, from] of times.entries()) {
    const to = times[index + 1] ?? now
    // A run up to one interval late is late, not missed; a minute of slack absorbs timer jitter.
    const missed = Math.floor((to - from + SLACK) / interval) - 1
    if (missed > 0) {
      gaps.push({ from, to, missed })
    }
  }
  return gaps
}
/** When the task is next due: now when it has never run, else one interval after its last run. */
export function nextDue(
  runs: Pick<VerificationRun, 'at' | 'task'>[],
  task: Pick<RecurringTask, 'id' | 'everyMinutes'>
): number {
  const last = Math.max(0, ...runs.filter((run) => run.task?.id === task.id).map((run) => run.at))
  return last === 0 ? 0 : last + task.everyMinutes * 60 * 1000
}
