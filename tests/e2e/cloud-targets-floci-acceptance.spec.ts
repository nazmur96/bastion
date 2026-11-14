import { captureCloudWindow } from './helpers/cloud-target-capture'
import { expect, test } from './helpers/orca-app'
import { openBastionPage } from './helpers/bastion-workspace'
import { clickCloudControl, expectUsableCloudControl } from './helpers/cloud-target-click'

test.use({
  orcaAppExtraArgs: process.env.ORCA_E2E_ISOLATED_X11 === '1' ? ['--ozone-platform=x11'] : []
})

// Direct lifecycle actions remain separate from reviewed target-bound source work.
test.describe('9.2a Floci AWS target', () => {
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
    orcaPage,
    electronApp
  }) => {
    const runtime = orcaPage.getByTestId('floci-target-runtime')
    await expect(runtime).toBeVisible()
    await expect(runtime).toContainText('Not started')
    await expect(runtime).toContainText('127.0.0.1')
    await expect(runtime).toContainText('sha256:')
    await expect(runtime).not.toContainText(':latest')
    await expectUsableCloudControl(runtime.getByRole('button', { name: 'Start', exact: true }))
    await captureCloudWindow(electronApp, orcaPage, test.info(), 'floci-runtime.png')
  })

  test('FL-02 offers direct Start and Stop and target-specific Reset confirmation', async ({
    orcaPage
  }) => {
    const runtime = orcaPage.getByTestId('floci-target-runtime')
    await expect(runtime).toBeVisible()
    await expect(runtime.getByRole('button', { name: 'Start', exact: true })).toBeEnabled()
    await expect(runtime.getByRole('button', { name: 'Stop', exact: true })).toBeVisible()
    await clickCloudControl(runtime.getByRole('button', { name: 'Reset data', exact: true }))
    const dialog = orcaPage.getByRole('dialog')
    await expect(dialog).toContainText('Disposable Floci target')
    await expect(dialog).toContainText('delete')
    await clickCloudControl(dialog.getByRole('button', { name: 'Cancel', exact: true }))
    await expect(dialog).toHaveCount(0)
  })
  test('FL-13 shows read-only resources only for a running target and never offers creation', async ({
    orcaPage
  }) => {
    const resources = orcaPage.getByTestId('floci-target-resources')
    await expect(resources).toBeVisible()
    await expect(resources).toContainText('Start this target to list resources')
    await expect(resources).not.toContainText('No resources found')
    await expect(
      resources.getByRole('button', { name: 'Create resource', exact: true })
    ).toHaveCount(0)
    // FL-09: a stopped target offers no terminal that could fall back to real credentials.
    await expect(
      resources.getByRole('button', { name: 'Open terminal for this target', exact: true })
    ).toHaveCount(0)
  })
  test('FL-08/09 a stopped target refuses its environment and listing in main', async ({
    orcaPage
  }) => {
    const refusals = await orcaPage.evaluate(async () => {
      const projectId = window.__store?.getState().activeWorktreeId ?? ''
      const read = await window.api.cloudTargets?.read(projectId)
      const targetId = read?.ok ? (read.snapshot.selection?.targetId ?? '') : ''
      const api = window.api.cloudTargets
      return [
        await api?.targetEnv?.({ projectId, targetId }),
        await api?.listResources?.({ projectId, targetId })
      ]
    })
    for (const refusal of refusals) {
      expect(refusal).toMatchObject({ ok: false, code: 'not-ready' })
    }
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
