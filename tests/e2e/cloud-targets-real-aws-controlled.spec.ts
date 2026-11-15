import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test as base, expect } from './helpers/orca-app'
import { openBastionPage } from './helpers/bastion-workspace'
import { clickCloudControl } from './helpers/cloud-target-click'
import { captureCloudWindow } from './helpers/cloud-target-capture'
const test = base.extend<{ installedAws: string }>({
  installedAws: async ({ seededRepoPath }, provide) => {
    const root = mkdtempSync(join(tmpdir(), 'real-aws-ui-')),
      bin = join(root, 'installs', 'aws-cli', '2.40.0', 'bin')
    mkdirSync(bin, { recursive: true })
    const source = `#!${process.execPath}\nconst a=process.argv.slice(2);if(a.includes('--version')){console.log('aws-cli/2.40.0 fixture');process.exit(0)}const r={sts:{Account:'000000000000',Arn:'arn:aws:iam::000000000000:user/fixture',UserId:'AIDA00000000000000000'},resourcegroupstaggingapi:{ResourceTagMappingList:[]},s3api:{Buckets:[{Name:'fixture-bucket'}]},dynamodb:{TableNames:[]},sqs:{QueueUrls:[]},lambda:{Functions:[]},budgets:{Budgets:[]}};if(!Object.hasOwn(r,a[0]))process.exit(254);console.log(JSON.stringify(r[a[0]]));\n`
    writeFileSync(join(bin, 'aws'), source, { mode: 0o700 })
    chmodSync(join(bin, 'aws'), 0o700)
    const pin = join(seededRepoPath, 'mise.toml')
    writeFileSync(
      pin,
      '[tools]\naws-cli={version="2.40.0",symlink_bins="true"}\n[env]\nAWS_PROFILE="IGNORED_PROJECT_PROFILE"\n'
    )
    try {
      await provide(root)
    } finally {
      rmSync(pin, { force: true })
      rmSync(root, { recursive: true, force: true })
    }
  },
  orcaAppExtraEnv: async ({ installedAws }, provide) => {
    await provide({ MISE_DATA_DIR: installedAws, MISE_AUTO_INSTALL: '0', MISE_OFFLINE: '1' })
  }
})
test.use({
  orcaAppExtraArgs: process.env.ORCA_E2E_ISOLATED_X11 === '1' ? ['--ozone-platform=x11'] : []
})
test('RA-06/08 verifies, confirms and reads through a controlled installed CLI without AWS', async ({
  orcaPage,
  electronApp
}, info) => {
  test.skip(
    process.platform === 'win32',
    'POSIX executable fixture; Windows live proof is not claimed'
  )
  await orcaPage.evaluate(async () => {
    const api = window.api.cloudTargets,
      projectId = window.__store?.getState().activeWorktreeId
    if (!api || !projectId) {
      throw new Error('Missing fixture')
    }
    const added = await api.update({
      projectId,
      revision: 0,
      mutation: {
        kind: 'add',
        label: 'Controlled real AWS',
        configuration: {
          kind: 'real',
          provider: 'aws',
          profileName: 'fixture-federated',
          region: 'us-east-1'
        }
      }
    })
    if (!added.ok) {
      throw new Error(added.message)
    }
    const selected = await api.update({
      projectId,
      revision: added.snapshot.revision,
      selection: added.snapshot.targets[0].id
    })
    if (!selected.ok) {
      throw new Error(selected.message)
    }
  })
  await openBastionPage(orcaPage, 'Cloud')
  const card = orcaPage.getByTestId('real-aws-target')
  // 9.5: budget alerts are always shown, as a free read that has not run yet.
  await expect(card.getByLabel('Real AWS budgets')).toContainText('Budget status: not checked')
  await clickCloudControl(card.getByRole('button', { name: 'Verify real AWS', exact: true }))
  await expect(card).toContainText('Observed account: 000000000000')
  await clickCloudControl(
    card.getByRole('button', { name: 'Use this identity for this target', exact: true })
  )
  await clickCloudControl(
    orcaPage.getByRole('dialog').getByRole('button', { name: 'Confirm identity', exact: true })
  )
  await expect(card).toContainText('Expected account: 000000000000')
  await clickCloudControl(card.getByRole('button', { name: 'Read resources', exact: true }))
  await expect(card.getByLabel('Real AWS resources')).toContainText('fixture-bucket')
  // 9.4: the shared view states its limits, scope and that ownership is not inferred.
  const view = card.getByTestId('cloud-resources-view')
  await expect(view).toContainText('Real AWS')
  await expect(view).toContainText('up to 3 pages and 500 items per service')
  await expect(view).toContainText('S3 buckets are global')
  await expect(view).toContainText('Ownership is not inferred')
  await clickCloudControl(card.getByRole('button', { name: 'Read budgets', exact: true }))
  await expect(card.getByLabel('Real AWS budgets')).toContainText('Budget status: absent')
  // 9.3b: an anchored identity enables the paid read, but nothing is requested without a confirmation.
  await expect(
    card.getByRole('button', { name: 'Fetch Cost Explorer data', exact: true })
  ).toBeEnabled()
  await expect(card.getByTestId('real-aws-costs')).toContainText('Not requested')
  await captureCloudWindow(electronApp, orcaPage, info, 'real-aws-controlled.png')
})
