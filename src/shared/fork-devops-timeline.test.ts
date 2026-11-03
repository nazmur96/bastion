import { describe, expect, it } from 'vitest'
import {
  eventsFor,
  flightStages,
  parseGitLog,
  parsePullRequest,
  parseWarningEvents,
  timelineWindow
} from './fork-devops-timeline'

const events = JSON.stringify({
  items: [
    {
      type: 'Warning',
      reason: 'BackOff',
      message: 'Back-off restarting failed container',
      lastTimestamp: '2026-11-04T10:00:00Z',
      involvedObject: { kind: 'Pod', name: 'web-7d9f8b6c5d-abcde', namespace: 'shop' }
    },
    {
      type: 'Normal',
      reason: 'Pulled',
      lastTimestamp: '2026-11-04T10:01:00Z',
      involvedObject: { kind: 'Pod', name: 'x', namespace: 'shop' }
    }
  ]
})

describe('timeline', () => {
  it('reads commits and only warning events, newest first in a window', () => {
    const commits = parseGitLog('1793700000\ta1b2c3d\tAda\tbump cache port\n')
    const warnings = parseWarningEvents(events)
    expect(commits[0]).toMatchObject({ kind: 'commit', ref: 'a1b2c3d', title: 'bump cache port' })
    expect(warnings).toHaveLength(1)
    const now = Date.parse('2026-11-04T11:00:00Z')
    expect(timelineWindow([...commits, ...warnings], now, 2).map((event) => event.kind)).toEqual([
      'warning'
    ])
  })

  it('ties pod events to their workload', () => {
    const warnings = parseWarningEvents(events)
    expect(eventsFor(warnings, 'shop', 'web')).toHaveLength(1)
    expect(eventsFor(warnings, 'shop', 'we')).toHaveLength(0)
  })

  it('flies a change from review to shipped', () => {
    const pr = parsePullRequest(
      JSON.stringify({
        number: 57,
        title: 'cache',
        url: 'u',
        state: 'OPEN',
        reviewDecision: 'APPROVED',
        statusCheckRollup: [{ conclusion: 'SUCCESS' }, { state: 'PENDING' }]
      })
    )
    expect(pr?.checks).toEqual({ passed: 1, failed: 0, pending: 1 })
    expect(flightStages(pr, false, false).map((stage) => stage.state)).toEqual([
      'done',
      'now',
      'waiting',
      'waiting',
      'waiting'
    ])
    const merged = parsePullRequest(
      JSON.stringify({
        number: 57,
        title: 'cache',
        url: 'u',
        state: 'MERGED',
        reviewDecision: '',
        statusCheckRollup: []
      })
    )
    expect(flightStages(merged, true, false).map((stage) => stage.state)).toEqual([
      'done',
      'done',
      'done',
      'done',
      'now'
    ])
    expect(flightStages(null, false, false)[0].detail).toBe('no pull request')
  })
})
