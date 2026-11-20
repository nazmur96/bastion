import { describe, expect, it } from 'vitest'
import { diagnosisAgentDraft } from './diagnosis-agent-draft'
import type { WorkloadDiagnosis } from './operations-contract'

const diagnosis: WorkloadDiagnosis = {
  namespace: 'preview',
  readAt: Date.UTC(2026, 10, 20, 12),
  rollouts: [
    {
      name: 'web',
      desired: 2,
      total: 2,
      updated: 1,
      ready: 1,
      available: 1,
      status: 'progressing',
      conditions: []
    }
  ],
  containers: [
    {
      pod: 'web-pod',
      container: 'app',
      ready: false,
      restarts: 3,
      state: 'waiting CrashLoopBackOff',
      lastExit: { code: 1, reason: 'Error' },
      digest: 'sha256:0123456789abcdef',
      revision: 'abcdef123456',
      revisionSource: 'registry image label'
    }
  ],
  events: [
    {
      reason: 'BackOff',
      object: 'Pod/web-pod',
      message: 'Restart failed {"password":"planted-event-password"}',
      count: 3,
      last: '2026-11-20T12:00:00Z'
    }
  ],
  logs: [
    {
      pod: 'web-pod',
      container: 'app',
      previous: false,
      text: 'current only',
      truncated: false,
      redactions: 0
    },
    {
      pod: 'web-pod',
      container: 'app',
      previous: true,
      text: 'Startup failed\nAuthorization: Bearer planted-log-token',
      truncated: false,
      redactions: 0
    }
  ],
  unknown: ['Registry: https://account:planted-url-password@example.invalid']
}

describe('diagnosis agent draft', () => {
  it('includes observed workload evidence and masks credentials before sharing', () => {
    const draft = diagnosisAgentDraft(diagnosis)
    for (const evidence of [
      'preview',
      'progressing',
      'CrashLoopBackOff',
      'exit 1 Error',
      'sha256:0123',
      'abcdef123456',
      'BackOff',
      'Startup failed',
      'Registry:',
      'Do not run commands'
    ]) {
      expect(draft).toContain(evidence)
    }
    expect(draft).toContain('[redacted]')
    expect(draft).not.toMatch(/planted-|current only/)
  })

  it('bounds each kind of evidence so oversized diagnostics cannot crowd out the log or unknowns', () => {
    const draft = diagnosisAgentDraft({
      ...diagnosis,
      rollouts: Array.from({ length: 100 }, () => ({
        ...diagnosis.rollouts[0],
        name: 'r'.repeat(4000)
      })),
      containers: Array.from({ length: 100 }, () => ({
        ...diagnosis.containers[0],
        pod: 'p'.repeat(4000),
        state: 's'.repeat(4000)
      })),
      events: Array.from({ length: 100 }, () => ({
        ...diagnosis.events[0],
        message: 'e'.repeat(4000)
      })),
      unknown: [...diagnosis.unknown, ...Array.from({ length: 100 }, () => 'u'.repeat(4000))],
      logs: [{ ...diagnosis.logs[1], text: `${'x'.repeat(14000)}\nStartup failed` }]
    })
    expect(draft.length).toBeLessThanOrEqual(2400)
    expect(draft).toContain('Startup failed')
    expect(draft).toContain('Registry:')
    expect(draft).toContain('omitted')
  })
})
