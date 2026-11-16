import { test, expect } from './helpers/orca-app'
import { openBastionPage } from './helpers/bastion-workspace'
import { clickCloudControl } from './helpers/cloud-target-click'

test('12.1–12.3 diagnosis stays unknown without a cluster; failed checks are kept; runbooks are new files', async ({
  orcaPage
}) => {
  await openBastionPage(orcaPage, 'Delivery')
  const page = orcaPage.getByTestId('workspace-delivery')
  await page.getByLabel('GitHub repository').fill('bastion-example/does-not-exist')
  await page.getByLabel('CI workflow file').fill('build.yml')
  await page.getByLabel('Deployment config').fill('deploy/kustomization.yaml')
  await page.getByLabel('Image name in config').fill('app')
  await page.getByLabel('Argo CD application').fill('example-app')

  // No reachable cluster: the diagnosis names what it could not read, never "healthy".
  const diagnosis = orcaPage.getByTestId('delivery-diagnosis')
  await clickCloudControl(diagnosis.getByRole('button', { name: 'Diagnose', exact: true }))
  await expect(orcaPage.getByTestId('diagnosis-unknown')).toContainText(
    'Unknown · Argo CD Application',
    { timeout: 60_000 }
  )

  // A check that cannot run is recorded as failed, with its reason.
  const verification = orcaPage.getByTestId('delivery-verification')
  await verification.getByLabel('Service').fill('example-app')
  await verification.getByLabel('Port').fill('8080')
  await verification.getByLabel('Expected text').fill('ok')
  await clickCloudControl(verification.getByRole('button', { name: 'Run journey check' }))
  const runs = orcaPage.getByTestId('runs')
  await expect(runs.locator('li').first()).toContainText('failed', { timeout: 60_000 })
  await expect(runs.locator('li').first()).toContainText('Not run')

  // The runbook draft is reviewed in a dialog and saved as a new repository file.
  const name = `e2e-${Date.now()}`
  await clickCloudControl(
    verification.getByRole('button', { name: 'Draft runbook from diagnosis…' })
  )
  const dialog = orcaPage.getByRole('dialog')
  await expect(dialog.getByLabel('Runbook content')).toHaveValue(/## Evidence/)
  await dialog.getByLabel('Title').fill(name)
  await expect(dialog).toContainText(`runbooks/${name}.md`)
  await clickCloudControl(dialog.getByRole('button', { name: 'Create runbook' }))
  await expect(verification.getByRole('status')).toContainText(`Created runbooks/${name}.md`)
  await expect(verification.getByRole('list', { name: 'Runbooks' })).toContainText(name)

  // A drill is recorded against the runbook it exercised.
  await verification.getByLabel('Drill runbook').selectOption(`runbooks/${name}.md`)
  await clickCloudControl(verification.getByRole('button', { name: 'Record drill result' }))
  await expect(runs.locator('li').first()).toContainText(`drill`, { timeout: 60_000 })
  await expect(runs.locator('li').first()).toContainText(`runbooks/${name}.md`)
  // The earlier failed check is still there.
  await expect(runs.locator('li').nth(1)).toContainText('Not run')
})
