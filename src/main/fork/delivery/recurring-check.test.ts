import { describe, expect, it } from 'vitest'
import type { RecurringRunRequest } from '../../../shared/fork-delivery/recurring-contract'
import { runRecurringCheck, type RecurringDeps } from './recurring-check'

const NOW = Date.parse('2026-11-20T12:00:00Z')
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
const task = { id: '00000000-0000-4000-8000-000000000001', scheduledAt: NOW - 1000 }
const app = JSON.stringify({ spec: { destination: { namespace: 'shop' } } })
function deps(kubectl: RecurringDeps['journey']['kubectl']): RecurringDeps {
  return {
    journey: { kubectl, imageLabels: async () => ({ labels: null, reason: 'none' }) },
    certificates: {
      kubectl,
      probe: async (host) =>
        host === 'ok.example'
          ? {
              ok: true,
              notAfter: new Date(NOW + 60 * 86400000).toISOString(),
              issuer: 'CA',
              trusted: true,
              trustError: null,
              hostnameMatches: true
            }
          : { ok: false, reason: 'ENOTFOUND' }
    },
    backups: { kubectl, runs: async () => [] }
  }
}
const cluster: RecurringDeps['journey']['kubectl'] = async (args) => {
  if (args.includes('applications.argoproj.io')) {
    return { ok: true, code: 'ok', out: app }
  }
  if (args[0] === 'get' && args[1] === '--raw') {
    return { ok: true, code: 'ok', out: 'healthy ok' }
  }
  return { ok: true, code: 'ok', out: JSON.stringify({ items: [] }) }
}
const run = (request: RecurringRunRequest['request']) =>
  runRecurringCheck({ projectId: 'p', task, request }, deps(cluster), NOW)

describe('recurring check runner', () => {
  it('runs a journey check as an ordinary check, tagged with its task', async () => {
    const result = await run({
      ...config,
      check: 'journey',
      journey: { service: 'web', port: 80, path: '/', expect: 'ok' }
    })
    expect([result.kind, result.passed, result.task, result.at]).toEqual(['check', true, task, NOW])
  })
  it('passes certificates only when every finding verified; unknown fails with its reason', async () => {
    const good = await run({
      ...config,
      check: 'certificates',
      endpoints: ['ok.example'],
      warnDays: 21
    })
    expect([good.kind, good.passed, good.detail]).toEqual([
      'certificates',
      true,
      '1 verified · 0 mismatch · 0 unknown'
    ])
    const partial = await run({
      ...config,
      check: 'certificates',
      endpoints: ['ok.example', 'gone.example'],
      warnDays: 21
    })
    expect([partial.passed, partial.detail]).toEqual([
      false,
      '1 verified · 0 mismatch · 1 unknown · gone.example:443: ENOTFOUND'
    ])
    const nothing = await run({ ...config, check: 'certificates', endpoints: [], warnDays: 21 })
    expect([nothing.passed, nothing.detail]).toEqual([false, 'nothing to check'])
  })
  it('fails a backup run on the first mismatch', async () => {
    const result = await run({
      ...config,
      check: 'backups',
      veleroNamespace: 'velero',
      staleHours: 26,
      drillDays: 90
    })
    expect([result.kind, result.passed, result.target]).toEqual([
      'backups',
      false,
      'Velero in velero · restore drill'
    ])
    expect(result.detail).toBe(
      '0 verified · 3 mismatch · 0 unknown · shop: no Velero backup covers shop'
    )
  })
})
