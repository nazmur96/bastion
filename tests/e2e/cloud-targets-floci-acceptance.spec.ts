import { expect, test } from './helpers/orca-app'
import { openBastionPage } from './helpers/bastion-workspace'
import { clickCloudControl } from './helpers/cloud-target-click'

// Proposed 9.2 contracts: no lifecycle command is executed in this spec round.
test.describe('9.2 Floci AWS target — red acceptance', () => {
  test.beforeEach(async ({ orcaPage }) => {
    await orcaPage.evaluate(async () => {
      const api = window.api.cloudTargets
      const projectId = window.__store?.getState().activeWorktreeId
      if (!api || !projectId) {
        throw new Error('Seeded workspace catalog is unavailable')
      }
      const created = await api.update({
        projectId,
        revision: 0,
        mutation: {
          kind: 'add',
          label: 'Disposable Floci target',
          configuration: {
            kind: 'emulated',
            provider: 'aws',
            emulator: 'floci',
            cliVersion: '0.4.0',
            runtimeId: 'local'
          }
        }
      })
      if (!created.ok) {
        throw new Error(created.message)
      }
      const selected = await api.update({
        projectId,
        revision: created.snapshot.revision,
        selection: created.snapshot.targets[0].id
      })
      if (!selected.ok) {
        throw new Error(selected.message)
      }
    })
    await openBastionPage(orcaPage, 'Cloud')
  })

  test('FL-01 exposes a stopped runtime with a loopback-only pinned launch policy', async ({
    orcaPage
  }) => {
    const runtime = orcaPage.getByTestId('floci-target-runtime')
    await expect(runtime).toBeVisible()
    await expect(runtime).toContainText('Not started')
    await expect(runtime).toContainText('127.0.0.1')
    await expect(runtime).toContainText('sha256:')
    await expect(runtime).not.toContainText(':latest')
    await expect(runtime.getByRole('button', { name: 'Prepare start', exact: true })).toBeEnabled()
  })

  test('FL-02 preparing Start opens a local-operation review without running it', async ({
    orcaPage
  }) => {
    const runtime = orcaPage.getByTestId('floci-target-runtime')
    await expect(runtime).toBeVisible()
    await clickCloudControl(runtime.getByRole('button', { name: 'Prepare start', exact: true }))
    const review = orcaPage.getByTestId('cloud-lifecycle-review')
    await expect(review).toBeVisible()
    await expect(review).toContainText('Disposable Floci target')
    await expect(review).toContainText('127.0.0.1')
    await expect(review).toContainText('sha256:')
    await expect(
      review.getByRole('button', { name: 'Run local operation', exact: true })
    ).toBeVisible()
    await expect(review).toContainText('Not run')
  })

  test('FL-13 distinguishes unavailable resource evidence from an empty running emulator', async ({
    orcaPage
  }) => {
    const resources = orcaPage.getByTestId('floci-target-resources')
    await expect(resources).toBeVisible()
    await expect(resources).toContainText('Start this target to list resources')
    await expect(resources).not.toContainText('No resources found')
    await expect(
      resources.getByRole('button', { name: 'Create resource', exact: true })
    ).toHaveCount(0)
  })

  for (const unsafe of [
    { endpoint: 'https://example.invalid' },
    { engineSocket: 'unix:///arbitrary.sock' },
    { env: { AWS_SECRET_ACCESS_KEY: 'PLANTED_SECRET_MUST_NOT_BE_STORED' } }
  ]) {
    test(`FL-08/15 read boundary refuses ${Object.keys(unsafe)[0]} before owner transport`, async ({
      orcaPage
    }) => {
      const result = await orcaPage.evaluate(async (extra): Promise<unknown> => {
        const api = window.api.cloudTargets
        const projectId = window.__store?.getState().activeWorktreeId
        if (!api || !projectId) {
          throw new Error('Seeded workspace catalog is unavailable')
        }
        const snapshot = await api.read(projectId)
        if (!snapshot.ok) {
          throw new Error(snapshot.message)
        }
        const readRuntime: unknown = Reflect.get(api, 'readRuntime')
        if (typeof readRuntime !== 'function') {
          throw new Error('9.2 readRuntime capability is not implemented')
        }
        const result: unknown = await Reflect.apply(readRuntime, api, [
          { projectId, targetId: snapshot.snapshot.targets[0].id, ...extra }
        ])
        return result
      }, unsafe)
      expect(result).toMatchObject({ ok: false, code: 'invalid' })
    })
  }
})
