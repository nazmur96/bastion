import { expect, test } from './helpers/orca-app'
import { openBastionPage } from './helpers/bastion-workspace'

test.describe('9.3 real AWS selection (metadata fixtures only; no cloud calls)', () => {
  test.beforeEach(async ({ orcaPage }) => {
    await orcaPage.evaluate(async () => {
      const api = window.api.cloudTargets,
        projectId = window.__store?.getState().activeWorktreeId
      if (!api || !projectId) {
        throw new Error('Seeded workspace missing')
      }
      const added = await api.update({
        projectId,
        revision: 0,
        mutation: {
          kind: 'add',
          label: 'Fixture production reference',
          configuration: {
            kind: 'real',
            provider: 'aws',
            profileName: 'fixture-federated',
            region: 'us-east-1'
          }
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
    })
    await openBastionPage(orcaPage, 'Cloud')
  })
  test('RA-06 distinguishes real AWS from emulation before any explicit verification', async ({
    orcaPage
  }) => {
    const target = orcaPage.getByTestId('real-aws-target')
    await expect(target).toBeVisible()
    await expect(target).toContainText('Real AWS')
    await expect(target).toContainText('Not verified')
    await expect(target).toContainText('fixture-federated')
    await expect(target).toContainText('us-east-1')
    await expect(target.getByRole('button', { name: 'Verify real AWS', exact: true })).toBeVisible()
    await expect(target.getByRole('button', { name: 'Start', exact: true })).toHaveCount(0)
    await expect(target).not.toContainText('No charges')
  })
  test('RA-09 keeps Cost Explorer unrequested with a visible charge notice', async ({
    orcaPage
  }) => {
    const costs = orcaPage.getByTestId('real-aws-costs')
    await expect(costs).toBeVisible()
    await expect(costs).toContainText('Not requested')
    await expect(costs).toContainText('May incur AWS API charges')
    await expect(
      costs.getByRole('button', { name: 'Fetch Cost Explorer data', exact: true })
    ).toBeDisabled()
  })
})
