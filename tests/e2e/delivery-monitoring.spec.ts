import { test, expect } from './helpers/orca-app'
import { openBastionPage } from './helpers/bastion-workspace'
import { clickCloudControl } from './helpers/cloud-target-click'

test('14.2 monitoring reports nothing attached without .bastion/monitoring.json', async ({
  orcaPage
}) => {
  await openBastionPage(orcaPage, 'Delivery')
  const page = orcaPage.getByTestId('workspace-delivery')
  await page.getByLabel('GitHub repository').fill('bastion-example/does-not-exist')
  await page.getByLabel('CI workflow file').fill('build.yml')
  await page.getByLabel('Deployment config').fill('deploy/kustomization.yaml')
  await page.getByLabel('Image name in config').fill('app')
  await page.getByLabel('Argo CD application').fill('example-app')

  const section = orcaPage.getByTestId('delivery-monitoring')
  await clickCloudControl(section.getByRole('button', { name: 'Read monitoring' }))
  await expect(orcaPage.getByTestId('monitoring-not-attached')).toBeVisible({ timeout: 60_000 })
  await expect(orcaPage.getByTestId('monitoring-evidence')).toHaveCount(0)
})
