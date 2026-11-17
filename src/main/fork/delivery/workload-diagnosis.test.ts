import { describe, expect, it } from 'vitest'
import type { DiagnoseRequest } from '../../../shared/fork-delivery/operations-contract'
import { readWorkloadDiagnosis, type DiagnosisDeps } from './workload-diagnosis'

const REPO = 'ghcr.io/example/spike'
const BAD = `sha256:${'b'.repeat(64)}`
const GOOD = `sha256:${'a'.repeat(64)}`
const request: DiagnoseRequest = {
  projectId: 'p',
  repository: 'example/spike',
  workflow: 'build.yml',
  configPath: 'deploy/kustomization.yaml',
  imageName: 'app',
  application: 'spike-app',
  applicationNamespace: 'argocd',
  revision: null,
  logs: false
}
const container = (name: string, digest: string, crashing: boolean) => ({
  metadata: { name },
  status: {
    containerStatuses: [
      {
        name: 'web',
        ready: !crashing,
        restartCount: crashing ? 3 : 0,
        imageID: `${REPO}@${digest}`,
        state: crashing ? { waiting: { reason: 'CrashLoopBackOff' } } : { running: {} },
        lastState: crashing ? { terminated: { exitCode: 1, reason: 'Error' } } : {}
      }
    ]
  }
})
// Mid-rollout: the new pod crashes while the old one still serves.
const OUTPUTS: Record<string, unknown> = {
  'applications.argoproj.io': { spec: { destination: { namespace: 'spike' } } },
  deployments: {
    items: [
      {
        metadata: { name: 'spike-app', generation: 3 },
        spec: { replicas: 1 },
        status: {
          observedGeneration: 3,
          replicas: 2,
          updatedReplicas: 1,
          readyReplicas: 1,
          availableReplicas: 1,
          conditions: [{ type: 'Progressing', status: 'True', reason: 'ReplicaSetUpdated' }]
        }
      }
    ]
  },
  pods: { items: [container('new', BAD, true), container('old', GOOD, false)] },
  events: {
    items: [
      {
        reason: 'BackOff',
        message: 'Back-off restarting failed container web',
        count: 6,
        lastTimestamp: '2026-11-16T22:29:48Z',
        involvedObject: { kind: 'Pod', name: 'new' }
      }
    ]
  }
}

function deps(overrides: Partial<DiagnosisDeps> = {}) {
  const calls: string[][] = []
  const value: DiagnosisDeps = {
    kubectl: async (args) => {
      calls.push(args)
      if (args.includes('logs')) {
        return {
          ok: true,
          code: 'ok',
          out: `nginx: [emerg] unknown directive "gzip_type"\nAuthorization: Bearer abcdefghijklmnop\n`
        }
      }
      const kind = Object.keys(OUTPUTS).find((key) => args.includes(key))
      return { ok: true, code: 'ok', out: JSON.stringify(kind ? OUTPUTS[kind] : {}) }
    },
    imageLabels: async (_repository, digest) => ({
      labels: {
        'org.opencontainers.image.revision': digest === BAD ? 'b'.repeat(40) : 'a'.repeat(40)
      },
      reason: null
    }),
    ...overrides
  }
  return { value, calls }
}

describe('workload diagnosis', () => {
  it('does not call a rollout complete while old pods still serve', async () => {
    const diagnosis = await readWorkloadDiagnosis(request, deps().value)
    expect(diagnosis.rollouts[0]).toMatchObject({ status: 'progressing', total: 2, desired: 1 })
  })
  it('links each running digest to the commit its registry label names', async () => {
    const diagnosis = await readWorkloadDiagnosis(request, deps().value)
    expect(diagnosis.containers[0]).toMatchObject({
      pod: 'new',
      ready: false,
      state: 'waiting CrashLoopBackOff',
      restarts: 3,
      lastExit: { code: 1, reason: 'Error' },
      digest: BAD,
      revision: 'b'.repeat(40)
    })
    expect(diagnosis.containers[1]).toMatchObject({ state: 'running', revision: 'a'.repeat(40) })
    expect(diagnosis.events[0]).toMatchObject({ reason: 'BackOff', object: 'Pod/new', count: 6 })
  })
  it('reads logs only when asked, current and previous, for failing containers only', async () => {
    const without = deps()
    expect((await readWorkloadDiagnosis(request, without.value)).logs).toEqual([])
    expect(without.calls.some((args) => args.includes('logs'))).toBe(false)
    const withLogs = deps()
    const diagnosis = await readWorkloadDiagnosis({ ...request, logs: true }, withLogs.value)
    expect(diagnosis.logs.map((log) => [log.pod, log.previous])).toEqual([
      ['new', false],
      ['new', true]
    ])
    expect(diagnosis.logs[1].text).toContain('unknown directive "gzip_type"')
    expect(diagnosis.logs[1].text).not.toContain('abcdefghijklmnop')
    expect(diagnosis.logs[1].redactions).toBe(1)
  })
  it('does not read logs of a ready container that restarted earlier and recovered', async () => {
    const recovered = container('old', GOOD, false)
    recovered.status.containerStatuses[0].restartCount = 1
    const pods = OUTPUTS.pods
    OUTPUTS.pods = { items: [recovered] }
    try {
      const diagnosis = await readWorkloadDiagnosis({ ...request, logs: true }, deps().value)
      expect(diagnosis.containers[0]).toMatchObject({ ready: true, restarts: 1 })
      expect(diagnosis.logs).toEqual([])
    } finally {
      OUTPUTS.pods = pods
    }
  })
  it('keeps an unreadable source unknown instead of empty', async () => {
    const denied = deps({ kubectl: async () => ({ ok: false, code: 'denied', out: '' }) })
    const diagnosis = await readWorkloadDiagnosis(request, denied.value)
    expect(diagnosis).toMatchObject({ namespace: null, containers: [] })
    expect(diagnosis.unknown).toEqual(['Argo CD Application: denied'])
    const noRegistry = deps({
      imageLabels: async () => ({ labels: null, reason: 'The registry needs credentials' })
    })
    const linked = await readWorkloadDiagnosis(request, noRegistry.value)
    expect(linked.containers[0]).toMatchObject({
      revision: null,
      revisionSource: 'The registry needs credentials'
    })
  })
})
