import { expect, test } from './helpers/orca-app'
import { activeBastionWorkspace, openBastionPage } from './helpers/bastion-workspace'

// Three or more concurrent Bastion launches on one desktop never exposed the store in local
// runs (serial and two-way runs passed); keep this file's launches sequential until resolved.
test.describe.configure({ mode: 'serial' })

test.describe('Bastion workspace harness', () => {
  test('launches straight into a seeded project workspace with the workbench loaded', async ({
    orcaPage
  }) => {
    const active = await activeBastionWorkspace(orcaPage)
    expect(active.activeId).not.toBe('home')
    expect(active.name).toBe('E2E workspace')
    const repos = await orcaPage.evaluate(() => window.__store?.getState().repos.length ?? 0)
    expect(repos).toBeGreaterThan(0)
  })

  test('renders Bastion workspace pages', async ({ orcaPage }) => {
    await openBastionPage(orcaPage, 'Project discovery')
    await expect(orcaPage.locator('[data-project-discovery]')).toBeVisible()
    await openBastionPage(orcaPage, 'Changes')
    await expect(orcaPage.locator('[data-workspace-changes]')).toBeVisible()
  })
})

test.describe('Bastion application home', () => {
  test.use({ bastionWorkspace: null, seedTestRepo: false })

  test('opens application home outside any workspace', async ({ electronApp }) => {
    const page = await electronApp.firstWindow({ timeout: 120_000 })
    await expect(page.getByText('APPLICATION HOME', { exact: false })).toBeVisible({
      timeout: 60_000
    })
  })
})
