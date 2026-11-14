import { expect, test } from './helpers/orca-app'
import { clickCloudControl } from './helpers/cloud-target-click'
import { openBastionPage } from './helpers/bastion-workspace'
import { captureCloudWindow } from './helpers/cloud-target-capture'

test.use({
  orcaAppExtraArgs: process.env.ORCA_E2E_ISOLATED_X11 === '1' ? ['--ozone-platform=x11'] : []
})

test.describe('9.1 cloud target acceptance', () => {
  test.beforeEach(async ({ electronApp }) => {
    await electronApp.evaluate(({ BrowserWindow }) => {
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.setBackgroundThrottling(false)
      }
    })
  })
  test('adds, renames and removes an unverified target', async ({ orcaPage }) => {
    await openBastionPage(orcaPage, 'Cloud')
    const targets = orcaPage.getByTestId('cloud-target-connections')
    await expect(targets).toBeVisible()
    await clickCloudControl(targets.getByRole('button', { name: 'Add target', exact: true }))
    await orcaPage.getByLabel('Target label', { exact: true }).fill('Disposable cloud')
    await orcaPage.getByLabel('AWS profile name', { exact: true }).fill('fixture-profile')
    await orcaPage.getByLabel('Region', { exact: true }).fill('us-east-1')
    await clickCloudControl(orcaPage.getByRole('button', { name: 'Save target', exact: true }))
    const target = targets.getByTestId('cloud-target-row').filter({ hasText: 'Disposable cloud' })
    await expect(target).toContainText('Not verified')
    await expect(target).toContainText('Real AWS')
    await clickCloudControl(target.getByRole('button', { name: 'Rename', exact: true }))
    await orcaPage.getByLabel('Target label', { exact: true }).fill('Renamed cloud')
    await clickCloudControl(orcaPage.getByRole('button', { name: 'Save target', exact: true }))
    const renamed = targets.getByTestId('cloud-target-row').filter({ hasText: 'Renamed cloud' })
    await expect(renamed).toBeVisible()
    await clickCloudControl(renamed.getByRole('button', { name: 'Remove target', exact: true }))
    await clickCloudControl(orcaPage.getByRole('button', { name: 'Confirm removal', exact: true }))
    await expect(renamed).toHaveCount(0)
  })

  test('shows which execution owner will resolve a target before any verification', async ({
    orcaPage
  }) => {
    await openBastionPage(orcaPage, 'Cloud')
    await expect(orcaPage.getByTestId('cloud-target-connections')).toBeVisible()
    await expect(orcaPage.getByTestId('cloud-target-owner-status')).toContainText('Local runtime')
  })
})

test.describe('cloud metadata behavior', () => {
  test('selection generations survive reload and selecting metadata makes no legacy provider probe', async ({
    orcaPage,
    electronApp
  }) => {
    await openBastionPage(orcaPage, 'Cloud')
    const setup = await orcaPage.evaluate(async () => {
      const projectId = window.__store?.getState().activeWorktreeId
      const api = window.api.cloudTargets
      if (!api || !projectId) {
        throw new Error('Fixture project missing')
      }
      const added = await api.update({
        projectId,
        revision: 0,
        mutation: {
          kind: 'add',
          label: 'Emulated fixture',
          configuration: {
            kind: 'emulated',
            provider: 'aws',
            emulator: 'floci',
            cliVersion: '0.4.0',
            runtimeId: 'local'
          }
        }
      })
      if (!added.ok) {
        throw new Error(added.message)
      }
      return { projectId, id: added.snapshot.targets[0].id }
    })
    const row = orcaPage.getByTestId('cloud-target-row')
    await expect(row).toContainText('Emulated AWS · Floci')
    await expect(row).toContainText('Not verified')
    await clickCloudControl(row.getByRole('button', { name: 'Select target', exact: true }))
    await clickCloudControl(orcaPage.getByRole('button', { name: 'Clear selection', exact: true }))
    await clickCloudControl(row.getByRole('button', { name: 'Select target', exact: true }))
    const before = await orcaPage.evaluate(
      (projectId) => window.api.cloudTargets?.read(projectId),
      setup.projectId
    )
    expect(before).toMatchObject({
      ok: true,
      snapshot: { selection: { targetId: setup.id, generation: 3 } }
    })
    const legacy = await orcaPage.evaluate(() => window.api.aiVault.cloudReadiness('/fixture'))
    expect(legacy).toMatchObject({
      error: 'Cloud verification is unavailable. Manage target metadata in Cloud Connections.'
    })
    await orcaPage.reload()
    await orcaPage.waitForFunction(() => Boolean(window.__store), null, { polling: 100 })
    await openBastionPage(orcaPage, 'Cloud')
    await expect(orcaPage.getByRole('button', { name: 'Selected', exact: true })).toBeVisible()
    await expect(orcaPage.getByTestId('cloud-target-row')).toContainText('Not verified')
    await captureCloudWindow(electronApp, orcaPage, test.info(), 'connections.png')
  })
})
