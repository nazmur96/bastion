import { describe, expect, it } from 'vitest'
import type { BackupsRequest } from '../../../shared/fork-delivery/backup-contract'
import type { VerificationRun } from '../../../shared/fork-delivery/operations-contract'
import { readBackupEvidence, type BackupDeps } from './backup-evidence'

const NOW = Date.parse('2026-11-20T12:00:00Z')
const ago = (hours: number) => new Date(NOW - hours * 60 * 60 * 1000).toISOString()
const request: BackupsRequest = {
  projectId: 'p',
  repository: 'example/app',
  workflow: 'build.yml',
  configPath: 'deploy/kustomization.yaml',
  imageName: 'app',
  application: 'app',
  applicationNamespace: 'argocd',
  revision: null,
  veleroNamespace: 'velero',
  staleHours: 26,
  drillDays: 90
}
const app = { spec: { destination: { namespace: 'shop' } } }
const backup = (name: string, created: number, phase: string, spec: object = {}) => ({
  metadata: { name, creationTimestamp: ago(created) },
  spec,
  status: {
    phase,
    ...(phase === 'Completed' ? { completionTimestamp: ago(created) } : {})
  }
})
const run = (runbook: string, days: number, passed: boolean): VerificationRun => ({
  id: runbook,
  kind: 'drill',
  runbook,
  at: NOW - days * 24 * 60 * 60 * 1000,
  passed,
  detail: '',
  target: 'https://app.example',
  revision: null,
  runningDigests: []
})
function deps(
  cluster: {
    app?: unknown
    backups?: unknown
    schedules?: unknown
    error?: string
  },
  runs: VerificationRun[] = []
): BackupDeps {
  return {
    runs: async () => runs,
    kubectl: async (args) => {
      if (args.includes('applications.argoproj.io')) {
        return cluster.app
          ? { ok: true, code: 'ok', out: JSON.stringify(cluster.app) }
          : { ok: false, code: 'no-context', out: '' }
      }
      if (cluster.error) {
        return { ok: false, code: 'failed', out: cluster.error }
      }
      const items = args.includes('backups.velero.io') ? cluster.backups : cluster.schedules
      return {
        ok: true,
        code: 'ok',
        out: JSON.stringify({ items: items ?? [] })
      }
    }
  }
}
const summary = (findings: { subject: string; status: string; detail: string }[]) =>
  findings.map((finding) => [finding.subject, finding.status, finding.detail])

describe('backup evidence', () => {
  it('uses the newest completed backup that covers the namespace, and the schedule state', async () => {
    const evidence = await readBackupEvidence(
      request,
      deps(
        {
          app,
          backups: [
            backup('other', 1, 'Completed', {
              includedNamespaces: ['billing']
            }),
            backup('excluded', 1, 'Completed', {
              excludedNamespaces: ['shop']
            }),
            backup('nightly-2', 3, 'Completed', {
              includedNamespaces: ['shop']
            }),
            backup('nightly-1', 27, 'Completed', { includedNamespaces: ['*'] })
          ],
          schedules: [
            {
              metadata: { name: 'nightly' },
              spec: {
                schedule: '0 2 * * *',
                template: { includedNamespaces: ['shop'] }
              },
              status: { phase: 'Enabled', lastBackup: ago(3) }
            },
            {
              metadata: { name: 'paused' },
              spec: { paused: true, template: {} },
              status: { phase: 'Enabled' }
            }
          ]
        },
        [run('runbooks/restore-database.md', 10, true), run('runbooks/rollback.md', 1, true)]
      ),
      NOW
    )
    expect(summary(evidence.backups)).toEqual([
      ['velero/nightly-2', 'verified', 'last completed 3 hours ago']
    ])
    expect(summary(evidence.schedules)).toEqual([
      ['velero/nightly', 'verified', '0 2 * * * · Enabled · last backup 3 hours ago'],
      ['velero/paused', 'mismatch', 'schedule paused']
    ])
    expect(summary([evidence.drill])).toEqual([
      ['runbooks/restore-database.md', 'verified', 'last restore drill passed 10 days ago']
    ])
    expect(evidence.unknown).toEqual([])
  })
  it('reports stale, failed and missing backups and drills as mismatches', async () => {
    const stale = await readBackupEvidence(
      request,
      deps({ app, backups: [backup('old', 30, 'Completed')] }, [
        run('runbooks/restore.md', 100, true)
      ]),
      NOW
    )
    expect(summary(stale.backups)).toEqual([
      ['velero/old', 'mismatch', 'last completed 30 hours ago']
    ])
    expect(summary(stale.schedules)).toEqual([
      ['shop', 'mismatch', 'no Velero schedule covers shop']
    ])
    expect(stale.drill.detail).toBe('last restore drill passed 100 days ago')
    const failed = await readBackupEvidence(
      request,
      deps(
        {
          app,
          backups: [backup('new', 1, 'PartiallyFailed'), backup('ok', 5, 'Completed')]
        },
        [run('runbooks/restore.md', 2, false)]
      ),
      NOW
    )
    expect(summary(failed.backups)).toEqual([
      ['velero/new', 'mismatch', 'latest backup PartiallyFailed; last completed 5 hours ago']
    ])
    expect(summary([failed.drill])).toEqual([
      ['runbooks/restore.md', 'mismatch', 'last restore drill failed 2 days ago']
    ])
    const none = await readBackupEvidence(request, deps({ app, backups: [] }), NOW)
    expect(summary(none.backups)).toEqual([['shop', 'mismatch', 'no Velero backup covers shop']])
    expect(none.drill.detail).toBe('no restore drill recorded')
  })
  it('keeps an unreadable cluster or a cluster without Velero unknown, never empty', async () => {
    expect((await readBackupEvidence(request, deps({}), NOW)).unknown).toEqual([
      'Argo CD Application: no-context'
    ])
    const without = await readBackupEvidence(
      request,
      deps({
        app,
        error: 'error: the server doesn\'t have a resource type "backups"'
      }),
      NOW
    )
    expect(without.backups).toEqual([])
    expect(without.unknown).toEqual([
      'Velero backups in velero: Velero not installed',
      'Velero schedules in velero: Velero not installed'
    ])
  })
})
