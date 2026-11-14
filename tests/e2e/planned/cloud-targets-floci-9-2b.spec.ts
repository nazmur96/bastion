import { expect, test } from '../helpers/orca-app'
import { openBastionPage } from '../helpers/bastion-workspace'

test('FL-13 deferred resource evidence contract', async ({ orcaPage }) => {
  test.skip(
    process.env.ORCA_E2E_FLOCI_9_2B !== '1',
    'Deliberately red until slice 9.2b is authorized'
  )
  await openBastionPage(orcaPage, 'Cloud')
  const resources = orcaPage.getByTestId('floci-target-resources')
  await expect(resources).toBeVisible()
  await expect(resources).toContainText('Start this target to list resources')
  await expect(resources).not.toContainText('No resources found')
  await expect(resources.getByRole('button', { name: 'Create resource', exact: true })).toHaveCount(
    0
  )
})
