import { test, expect } from './helpers/orca-app'
import { openBastionPage } from './helpers/bastion-workspace'
import { clickCloudControl } from './helpers/cloud-target-click'
import type { Page } from '@stablyai/playwright-test'

async function addCertificateTask(orcaPage: Page): Promise<void> {
  await openBastionPage(orcaPage, 'Delivery')
  const page = orcaPage.getByTestId('workspace-delivery')
  await page.getByLabel('GitHub repository').fill('bastion-example/does-not-exist')
  await page.getByLabel('CI workflow file').fill('build.yml')
  await page.getByLabel('Deployment config').fill('deploy/kustomization.yaml')
  await page.getByLabel('Image name in config').fill('app')
  await page.getByLabel('Argo CD application').fill('example-app')
  const section = orcaPage.getByTestId('delivery-recurring')
  await section.getByLabel('Check type').selectOption('certificates')
  await section.getByLabel('Task name').fill('certs')
  await section.getByLabel('Every (minutes)').fill('5')
  // .invalid never resolves (RFC 2606): each run is a real, failed, unknown result.
  await section.getByLabel('Endpoints', { exact: true }).fill('app.bastion.invalid')
  await clickCloudControl(section.getByRole('button', { name: 'Add recurring check' }))
}
const task = (orcaPage: Page) => orcaPage.locator('[data-task="certs"]')

test('14.5 a recurring check runs at once while the workspace is open and joins the run history', async ({
  orcaPage
}) => {
  await addCertificateTask(orcaPage)
  await expect(task(orcaPage)).toContainText('failed', { timeout: 60_000 })
  await expect(task(orcaPage)).toContainText('app.bastion.invalid:443')
  await expect(task(orcaPage)).toContainText('next ')
  await expect(orcaPage.getByTestId('runs')).toContainText('certificates')
})

// Real timers, about 18 minutes: BASTION_RECURRING_SOAK=1 enables it.
test('14.5 soak: a paused gap shows as missed, then the task catches up and repeats on its own', async ({
  orcaPage
}) => {
  test.skip(!process.env.BASTION_RECURRING_SOAK, 'set BASTION_RECURRING_SOAK=1')
  test.setTimeout(25 * 60_000)
  await addCertificateTask(orcaPage)
  await expect(task(orcaPage)).toContainText('failed', { timeout: 60_000 })
  await clickCloudControl(task(orcaPage).getByLabel('Enabled'))
  await expect(task(orcaPage)).toContainText('paused')
  await orcaPage.waitForTimeout(11 * 60_000)
  await clickCloudControl(task(orcaPage).getByLabel('Enabled'))
  await expect(task(orcaPage).locator('[data-missed="1"]')).toBeVisible({ timeout: 90_000 })
  await expect(orcaPage.getByTestId('runs').locator('li', { hasText: 'certificates' })).toHaveCount(
    2
  )
  await expect(orcaPage.getByTestId('runs').locator('li', { hasText: 'certificates' })).toHaveCount(
    3,
    {
      timeout: 6 * 60_000
    }
  )
})
