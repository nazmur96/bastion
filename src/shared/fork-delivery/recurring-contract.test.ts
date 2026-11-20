import { describe, expect, it } from 'vitest'
import { missedRuns, nextDue, recurringCheckSchema } from './recurring-contract'

const MIN = 60 * 1000
const task = { id: '00000000-0000-4000-8000-000000000001', everyMinutes: 15 }
const run = (minutes: number, id = task.id) => ({ at: minutes * MIN, task: { id, scheduledAt: 0 } })

describe('recurring schedule', () => {
  it('counts only slots more than one interval late, between runs and since the last run', () => {
    expect(missedRuns([run(0), run(15.5), run(31)], task, 40 * MIN)).toEqual([])
    // Late by most of an interval is late, not missed.
    expect(missedRuns([run(0), run(28)], task, 30 * MIN)).toEqual([])
    // Closed from 0 to 62: the 15, 30 and 45 slots were missed; the 60 slot ran at 62.
    expect(missedRuns([run(0), run(62)], task, 70 * MIN)).toEqual([
      { from: 0, to: 62 * MIN, missed: 3 }
    ])
    // Closed since the last run: shown up to now, nothing recorded.
    expect(missedRuns([run(0)], task, 46 * MIN)).toEqual([{ from: 0, to: 46 * MIN, missed: 2 }])
    expect(missedRuns([run(0, '00000000-0000-4000-8000-000000000002')], task, 90 * MIN)).toEqual([])
  })
  it('is due now when never run, else one interval after the last run', () => {
    expect(nextDue([], task)).toBe(0)
    expect(nextDue([run(10), run(30)], task)).toBe(45 * MIN)
  })
  it('admits only the three read-only checks', () => {
    const config = {
      projectId: 'p',
      repository: 'example/app',
      workflow: 'build.yml',
      configPath: 'deploy/kustomization.yaml',
      imageName: 'app',
      application: 'app',
      applicationNamespace: 'argocd',
      revision: null
    }
    expect(
      recurringCheckSchema.safeParse({
        ...config,
        check: 'certificates',
        endpoints: [],
        warnDays: 21
      }).success
    ).toBe(true)
    for (const check of ['promote', 'cost-and-usage', 'apply']) {
      expect(recurringCheckSchema.safeParse({ ...config, check }).success).toBe(false)
    }
    expect(
      recurringCheckSchema.safeParse({
        ...config,
        check: 'certificates',
        endpoints: [],
        warnDays: 21,
        digest: 'sha256:x'
      }).success
    ).toBe(false)
  })
})
