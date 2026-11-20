import { test, expect } from './helpers/orca-app'
import { openBastionPage } from './helpers/bastion-workspace'
import { clickCloudControl } from './helpers/cloud-target-click'

test('14.4 backup evidence reports an unread cluster as unknown and a missing restore drill', async ({
  orcaPage
}) => {
  await openBastionPage(orcaPage, 'Delivery')
  const page = orcaPage.getByTestId('workspace-delivery')
  await page.getByLabel('GitHub repository').fill('bastion-example/does-not-exist')
  await page.getByLabel('CI workflow file').fill('build.yml')
  await page.getByLabel('Deployment config').fill('deploy/kustomization.yaml')
  await page.getByLabel('Image name in config').fill('app')
  await page.getByLabel('Argo CD application').fill('example-app')

  const section = orcaPage.getByTestId('delivery-backups')
  await clickCloudControl(section.getByRole('button', { name: 'Check backups' }))
  const evidence = orcaPage.getByTestId('backup-evidence')
  await expect(evidence).toBeVisible({ timeout: 60_000 })
  await expect(evidence.locator('[data-backup="restore drill"]')).toContainText(
    'no restore drill recorded'
  )
  await expect(orcaPage.getByTestId('backup-unknown')).toContainText('Argo CD Application')
})
