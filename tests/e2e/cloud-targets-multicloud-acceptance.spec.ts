import { expect, test } from './helpers/orca-app'
import { openBastionPage } from './helpers/bastion-workspace'
import { clickCloudControl, expectUsableCloudControl } from './helpers/cloud-target-click'
for (const provider of ['azure', 'gcp', 'oci'] as const) {
  test(`MC-06 ${provider} uses the existing stopped lifecycle card, costs and Reset dialog without starting an engine`, async ({
    orcaPage
  }) => {
    await orcaPage.evaluate(async (provider) => {
      const api = window.api.cloudTargets,
        projectId = window.__store?.getState().activeWorktreeId
      if (!api || !projectId) {
        throw new Error('Missing seeded workspace')
      }
      const added = await api.update({
        projectId,
        revision: 0,
        mutation: {
          kind: 'add',
          label: `Fixture ${provider}`,
          configuration: { kind: 'emulated', provider, emulator: 'floci', runtimeId: 'local' }
        }
      })
      if (!added.ok) {
        throw new Error(added.message)
      }
      const selected = await api.update({
        projectId,
        revision: added.snapshot.revision,
        selection: added.snapshot.targets[0].id
      })
      if (!selected.ok) {
        throw new Error(selected.message)
      }
    }, provider)
    await openBastionPage(orcaPage, 'Cloud')
    const runtime = orcaPage.getByTestId('floci-target-runtime')
    await expect(runtime).toBeVisible()
    await expect(runtime).toContainText(
      provider === 'azure' ? 'Floci Azure' : provider === 'gcp' ? 'Floci GCP' : 'Floci OCI'
    )
    await expect(runtime).toContainText('Not started')
    await expect(runtime).toContainText('127.0.0.1')
    await expect(runtime).toContainText('sha256:')
    await expect(orcaPage.getByTestId('floci-costs')).toContainText('Emulated · No charges')
    await expectUsableCloudControl(runtime.getByRole('button', { name: 'Start', exact: true }))
    await expect(runtime.getByRole('button', { name: 'Stop', exact: true })).toBeVisible()
    await clickCloudControl(runtime.getByRole('button', { name: 'Reset data', exact: true }))
    const dialog = orcaPage.getByRole('dialog')
    await expect(dialog).toContainText(`Fixture ${provider}`)
    await clickCloudControl(dialog.getByRole('button', { name: 'Cancel', exact: true }))
    await expect(dialog).toHaveCount(0)
  })
}
