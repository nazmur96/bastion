import { randomUUID } from 'node:crypto'
import { lstatSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { test, expect } from './helpers/orca-app'
import { ownerMiseDataDir } from '../../src/main/fork/cloud/real-aws-tool'
const enabled = process.env.ORCA_AWS_REAL_PROOF === '1'
const dataDir = ownerMiseDataDir()
test.use({ orcaAppExtraEnv: { MISE_DATA_DIR: dataDir, MISE_AUTO_INSTALL: '0', MISE_OFFLINE: '1' } })
test.describe('opt-in real AWS read-only proof', () => {
  test.skip(!enabled, 'Requires explicit sign-in confirmation and owner-supplied profile/region')
  test('RA-12 uses the registered disposable project and production adapter without Cost Explorer', async ({
    electronApp,
    orcaPage,
    seededRepoPath
  }, info) => {
    test.setTimeout(180000)
    const profileName = process.env.ORCA_AWS_REAL_PROOF_PROFILE,
      region = process.env.ORCA_AWS_REAL_PROOF_REGION
    if (!profileName || !region) {
      throw new Error('Supply profile and region at runtime; no defaults are used')
    }
    const compareVersions = new Intl.Collator('en', { numeric: true }).compare
    const versions = readdirSync(join(dataDir, 'installs', 'aws-cli'))
      .filter((version) => /^2\.\d+\.\d+$/.test(version))
      .sort(compareVersions)
    const version = versions.at(-1)
    if (!version) {
      throw new Error('No existing owner AWS CLI installation; no installation attempted')
    }
    const isolatedHome = await electronApp.evaluate(({ app }) => app.getPath('home'))
    const link = join(isolatedHome, '.aws'),
      pin = join(seededRepoPath, 'mise.toml')
    let linked = false,
      pinned = false
    try {
      // Only the CLI opens the engineer-owned provider files; no credential bytes are read/copied.
      symlinkSync(join(homedir(), '.aws'), link, process.platform === 'win32' ? 'junction' : 'dir')
      linked = true
      writeFileSync(pin, `[tools]\naws-cli = { version = "${version}", symlink_bins = "true" }\n`, {
        flag: 'wx',
        mode: 0o600
      })
      pinned = true
      const report = await orcaPage.evaluate(
        async ({ profileName, region, resourceRequestId, budgetRequestId }) => {
          const api = window.api.cloudTargets,
            projectId = window.__store?.getState().activeWorktreeId
          if (
            !api?.verifyRealTarget ||
            !api.acceptRealIdentity ||
            !api.readRealTarget ||
            !projectId
          ) {
            throw new Error('Real AWS bridge unavailable')
          }
          const current = await api.read(projectId)
          if (!current.ok) {
            throw new Error(current.message)
          }
          const added = await api.update({
            projectId,
            revision: current.snapshot.revision,
            mutation: {
              kind: 'add',
              label: 'Read-only proof fixture',
              configuration: { kind: 'real', provider: 'aws', profileName, region }
            }
          })
          if (!added.ok) {
            throw new Error(added.message)
          }
          const targetId = added.snapshot.targets[0].id
          const selected = await api.update({
            projectId,
            revision: added.snapshot.revision,
            selection: targetId
          })
          if (!selected.ok) {
            throw new Error(selected.message)
          }
          const verified = await api.verifyRealTarget({ projectId, targetId })
          if (!verified.ok) {
            throw new Error(verified.message)
          }
          const accepted = await api.acceptRealIdentity({
            projectId,
            targetId,
            observationId: verified.value.observationId,
            revision: selected.snapshot.revision
          })
          if (!accepted.ok) {
            throw new Error(accepted.message)
          }
          const resources = await api.readRealTarget({
            projectId,
            targetId,
            operation: 'resources',
            requestId: resourceRequestId
          })
          if (!resources.ok) {
            throw new Error(resources.message)
          }
          const budgets = await api.readRealTarget({
            projectId,
            targetId,
            operation: 'budgets',
            requestId: budgetRequestId
          })
          if (!budgets.ok) {
            throw new Error(budgets.message)
          }
          return {
            toolVersion: verified.value.toolVersion,
            accountMatched:
              verified.value.accountId === resources.value.identity.accountId &&
              verified.value.accountId === budgets.value.identity.accountId,
            resourceStatuses:
              'results' in resources.value.data
                ? resources.value.data.results.map((service) => ({
                    service: service.service,
                    status: service.status,
                    count: service.items.length,
                    truncated: service.truncated
                  }))
                : [],
            budgetSummary: 'status' in budgets.value.data ? budgets.value.data : null,
            operations: [...resources.value.operations, ...budgets.value.operations]
          }
        },
        { profileName, region, resourceRequestId: randomUUID(), budgetRequestId: randomUUID() }
      )
      expect(report.accountMatched).toBe(true)
      expect(report.toolVersion).toBe(version)
      expect(report.resourceStatuses).toHaveLength(5)
      expect(
        report.resourceStatuses.every(
          (service) => service.status === 'ok' || service.status === 'denied'
        )
      ).toBe(true)
      expect(
        report.operations.every((operation) =>
          [
            'identity',
            'role',
            'tagging',
            's3',
            'dynamodb',
            'sqs',
            'lambda',
            'budgets',
            'notifications',
            'subscribers'
          ].includes(operation)
        )
      ).toBe(true)
      const sanitized = JSON.stringify(report, null, 2)
      console.log('READ_ONLY_OPERATION_LOG', sanitized)
      writeFileSync(info.outputPath('read-only-operation-log.json'), sanitized)
    } finally {
      if (pinned) {
        rmSync(pin)
      }
      if (linked && lstatSync(link).isSymbolicLink()) {
        rmSync(link)
      }
    }
  })
})
