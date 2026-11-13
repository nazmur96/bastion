import { expect, test } from './helpers/orca-app'
import { openBastionPage } from './helpers/bastion-workspace'

// Deliberately red: this is the reviewed-before-implementation contract for slice 9.1.
test.describe('9.1 cloud target acceptance', () => {
  test('adds, renames and removes an unverified target', async ({ orcaPage }) => {
    await openBastionPage(orcaPage, 'Cloud')
    const targets = orcaPage.getByTestId('cloud-target-connections')
    await expect(targets).toBeVisible()
    await targets.getByRole('button', { name: 'Add target', exact: true }).click()
    await orcaPage.getByLabel('Target label', { exact: true }).fill('Disposable cloud')
    await orcaPage.getByLabel('AWS profile name', { exact: true }).fill('fixture-profile')
    await orcaPage.getByLabel('Region', { exact: true }).fill('us-east-1')
    await orcaPage.getByRole('button', { name: 'Save target', exact: true }).click()
    const target = targets.getByTestId('cloud-target-row').filter({ hasText: 'Disposable cloud' })
    await expect(target).toContainText('Not verified')
    await expect(target).toContainText('Real AWS')
    await target.getByRole('button', { name: 'Rename', exact: true }).click()
    await orcaPage.getByLabel('Target label', { exact: true }).fill('Renamed cloud')
    await orcaPage.getByRole('button', { name: 'Save target', exact: true }).click()
    const renamed = targets.getByTestId('cloud-target-row').filter({ hasText: 'Renamed cloud' })
    await expect(renamed).toBeVisible()
    await renamed.getByRole('button', { name: 'Remove target', exact: true }).click()
    await orcaPage.getByRole('button', { name: 'Confirm removal', exact: true }).click()
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
