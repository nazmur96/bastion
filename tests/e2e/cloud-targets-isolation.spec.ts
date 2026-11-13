import type { ElectronApplication } from '@stablyai/playwright-test'
import { expect, test } from './helpers/orca-app'
import { createRestartSession, attachRepoAndOpenTerminal } from './helpers/orca-restart'
import { seedBastionWorkspace, openBastionPage } from './helpers/bastion-workspace'

test('cloud catalog and selections stay in their workspace across A to B to A restarts', async ({
  testRepoPath
}, testInfo) => {
  test.setTimeout(240_000)
  const session = createRestartSession(testInfo)
  const a = seedBastionWorkspace(session.userDataDir, 'A'),
    b = seedBastionWorkspace(session.userDataDir, 'B')
  let app: ElectronApplication | undefined
  try {
    const home = await session.launch({ waitForWorkbench: false })
    app = home.app
    await expect(home.page.getByText('APPLICATION HOME', { exact: false })).toBeVisible()
    expect(await home.page.evaluate(() => window.api.cloudTargets?.read('fixture'))).toMatchObject({
      ok: false,
      code: 'workspace'
    })
    await session.close(app)
    app = undefined
    const first = await session.launch({ extraArgs: [a.launchArg] })
    app = first.app
    const projectA = await attachRepoAndOpenTerminal(first.page, testRepoPath)
    const created = await first.page.evaluate(async (projectId) => {
      const api = window.api.cloudTargets
      if (!api) {
        throw new Error('Cloud API missing')
      }
      const result = await api.update({
        projectId,
        revision: 0,
        mutation: {
          kind: 'add',
          label: 'A only',
          configuration: {
            kind: 'real',
            provider: 'aws',
            profileName: 'fixture',
            region: 'us-east-1'
          }
        }
      })
      if (!result.ok) {
        throw new Error(result.message)
      }
      const target = result.snapshot.targets[0]
      const selected = await api.update({
        projectId,
        revision: result.snapshot.revision,
        selection: target.id
      })
      if (!selected.ok) {
        throw new Error(selected.message)
      }
      return target.id
    }, projectA)
    await openBastionPage(first.page, 'Cloud')
    await expect(first.page.getByTestId('cloud-target-row')).toContainText('A only')
    await expect(first.page.getByRole('button', { name: 'Selected', exact: true })).toBeVisible()
    await session.close(app)
    app = undefined
    const second = await session.launch({ extraArgs: [b.launchArg] })
    app = second.app
    const projectB = await attachRepoAndOpenTerminal(second.page, testRepoPath)
    await openBastionPage(second.page, 'Cloud')
    await expect(
      second.page.getByText('No cloud targets in this workspace.', { exact: false })
    ).toBeVisible()
    const foreign = await second.page.evaluate(
      async ({ projectId, id }) =>
        window.api.cloudTargets?.update({ projectId, revision: 0, selection: id }),
      { projectId: projectB, id: created }
    )
    expect(foreign).toMatchObject({ ok: false, code: 'unavailable' })
    await session.close(app)
    app = undefined
    const third = await session.launch({ extraArgs: [a.launchArg] })
    app = third.app
    await attachRepoAndOpenTerminal(third.page, testRepoPath)
    await openBastionPage(third.page, 'Cloud')
    await expect(third.page.getByTestId('cloud-target-row')).toContainText('A only')
    await expect(third.page.getByRole('button', { name: 'Selected', exact: true })).toBeVisible()
    await session.close(app)
    app = undefined
    const returned = await session.launch({ waitForWorkbench: false })
    app = returned.app
    await expect(returned.page.getByText('APPLICATION HOME', { exact: false })).toBeVisible()
    expect(
      await returned.page.evaluate(() => window.api.cloudTargets?.read('fixture'))
    ).toMatchObject({ ok: false, code: 'workspace' })
  } finally {
    await session.dispose(app)
  }
})

test.describe('cloud targets outside a workspace', () => {
  test.use({ bastionWorkspace: null, seedTestRepo: false })
  test('Home refuses metadata and selection requests', async ({ electronApp }) => {
    const page = await electronApp.firstWindow()
    await expect(page.getByText('APPLICATION HOME', { exact: false })).toBeVisible()
    const result = await page.evaluate(() => window.api.cloudTargets?.read('fixture'))
    expect(result).toMatchObject({ ok: false, code: 'workspace' })
  })
})
