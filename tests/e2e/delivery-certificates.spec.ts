import { test, expect } from './helpers/orca-app'
import { openBastionPage } from './helpers/bastion-workspace'
import { clickCloudControl } from './helpers/cloud-target-click'

test('14.3 certificate evidence reports unreachable endpoints and an unread cluster as unknown', async ({
  orcaPage
}) => {
  await openBastionPage(orcaPage, 'Delivery')
  const page = orcaPage.getByTestId('workspace-delivery')
  await page.getByLabel('GitHub repository').fill('bastion-example/does-not-exist')
  await page.getByLabel('CI workflow file').fill('build.yml')
  await page.getByLabel('Deployment config').fill('deploy/kustomization.yaml')
  await page.getByLabel('Image name in config').fill('app')
  await page.getByLabel('Argo CD application').fill('example-app')

  const section = orcaPage.getByTestId('delivery-certificates')
  // .invalid never resolves (RFC 2606), so no real endpoint is contacted.
  await section.getByLabel('Endpoints (host or host:port, up to 10)').fill('app.bastion.invalid')
  await clickCloudControl(section.getByRole('button', { name: 'Check certificates' }))
  const evidence = orcaPage.getByTestId('certificate-evidence')
  await expect(evidence).toBeVisible({ timeout: 60_000 })
  await expect(evidence.locator('[data-certificate="app.bastion.invalid:443"]')).toContainText(
    'unknown'
  )
  await expect(orcaPage.getByTestId('certificate-unknown')).toContainText('Argo CD Application')
})
