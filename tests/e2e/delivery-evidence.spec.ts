import { test, expect } from './helpers/orca-app'
import { openBastionPage } from './helpers/bastion-workspace'
import { clickCloudControl } from './helpers/cloud-target-click'

test('11.1 shows every delivery link and refuses promotion when evidence is unknown', async ({
  orcaPage
}) => {
  await openBastionPage(orcaPage, 'Delivery')
  const page = orcaPage.getByTestId('workspace-delivery')
  await expect(page).toBeVisible()
  const read = page.getByRole('button', { name: 'Read delivery evidence', exact: true })
  // Settings are validated before anything is read.
  await expect(read).toBeDisabled()
  await page.getByLabel('GitHub repository').fill('bastion-example/does-not-exist')
  await page.getByLabel('CI workflow file').fill('build.yml')
  await page.getByLabel('Deployment config').fill('deploy/kustomization.yaml')
  await page.getByLabel('Image name in config').fill('app')
  await page.getByLabel('Argo CD application').fill('example-app')
  await expect(read).toBeEnabled()
  await clickCloudControl(read)

  const chain = orcaPage.getByTestId('delivery-chain')
  await expect(chain).toBeVisible({ timeout: 60_000 })
  for (const label of [
    'Source revision',
    'CI result',
    'Published artifact',
    'Registry image',
    'Deployment config',
    'Controller (Argo CD)',
    'Running pods'
  ]) {
    await expect(chain).toContainText(label)
  }
  // No CI evidence for this revision: unknown, never green, and promotion is refused.
  await expect(chain.locator('[data-link="ci"]')).toContainText('unknown')
  await expect(chain.locator('[data-link="running"]')).toContainText('unknown')
  await expect(orcaPage.getByTestId('delivery-blocked')).toContainText('CI result is not verified')
  await expect(chain.getByRole('button', { name: 'Promote this revision…' })).toHaveCount(0)
})
