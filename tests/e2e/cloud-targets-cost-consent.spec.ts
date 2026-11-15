import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test as base, expect } from './helpers/orca-app'
import { openBastionPage } from './helpers/bastion-workspace'
import { clickCloudControl } from './helpers/cloud-target-click'

const test = base.extend<{ billingFixture: { data: string; log: string } }>({
  billingFixture: async ({ seededRepoPath }, provide) => {
    const data = mkdtempSync(join(tmpdir(), 'billing-ui-fake-')),
      bin = join(data, 'installs', 'aws-cli', '2.40.0', 'bin'),
      log = join(data, 'charges.jsonl')
    mkdirSync(bin, { recursive: true })
    const script = `#!${process.execPath}\nconst fs=require('fs'),a=process.argv.slice(2);if(a.includes('--version')){console.log('aws-cli/2.40.0 fixture');process.exit(0)}let r;if(a[0]==='ce'){fs.appendFileSync(${JSON.stringify(log)},JSON.stringify(a)+'\\n');r={ResultsByTime:[{TimePeriod:JSON.parse(a[a.indexOf('--cli-input-json')+1]).TimePeriod,Total:{UnblendedCost:{Amount:'1.25',Unit:'USD'}},Estimated:true}]}}else if(a[0]==='sts'){r={Account:'000000000000',Arn:'arn:aws:iam::000000000000:user/fixture',UserId:'AIDA_FIXTURE'}}else{r={ResourceTagMappingList:[],Buckets:[],TableNames:[],QueueUrls:[],Functions:[],Budgets:[]}}console.log(JSON.stringify(r));\n`
    writeFileSync(join(bin, 'aws'), script, { mode: 0o700 })
    chmodSync(join(bin, 'aws'), 0o700)
    const pin = join(seededRepoPath, 'mise.toml')
    writeFileSync(pin, '[tools]\naws-cli="2.40.0"\n', { flag: 'wx' })
    try {
      await provide({ data, log })
    } finally {
      rmSync(pin, { force: true })
      rmSync(data, { recursive: true, force: true })
    }
  },
  orcaAppExtraEnv: async ({ billingFixture }, provide) => {
    await provide({ MISE_DATA_DIR: billingFixture.data, MISE_AUTO_INSTALL: '0', MISE_OFFLINE: '1' })
  }
})
test('RA-09 full UI consent: selection, reload, focus, cache miss and cancellation never charge; explicit confirmation charges once', async ({
  orcaPage,
  billingFixture
}) => {
  test.skip(
    process.platform === 'win32',
    'POSIX fake CLI fixture; Windows rendering proof remains separate'
  )
  const charges = () =>
    existsSync(billingFixture.log)
      ? readFileSync(billingFixture.log, 'utf8').trim().split('\n').length
      : 0
  await orcaPage.evaluate(async () => {
    const api = window.api.cloudTargets,
      projectId = window.__store?.getState().activeWorktreeId
    if (!api || !projectId) {
      throw new Error('Missing seeded workspace')
    }
    const added = await api.update({
      projectId,
      revision: 0,
      mutation: {
        kind: 'add',
        label: 'Billing fixture',
        configuration: {
          kind: 'real',
          provider: 'aws',
          profileName: 'fixture-profile',
          region: 'us-west-2'
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
  expect(charges()).toBe(0)
  await orcaPage.reload()
  await expect(
    orcaPage.locator('.workspace-nav-item').filter({ hasText: 'Cloud' }).first()
  ).toBeVisible()
  await openBastionPage(orcaPage, 'Cloud')
  await orcaPage.evaluate(() => window.dispatchEvent(new Event('focus')))
  expect(charges()).toBe(0)
  const real = orcaPage.getByTestId('real-aws-target'),
    costs = orcaPage.getByTestId('real-aws-costs')
  await clickCloudControl(real.getByRole('button', { name: 'Verify real AWS', exact: true }))
  // The first verify in a cold app spawns the fake CLI twice; allow for a slow start.
  await expect(real).toContainText('Observed account: 000000000000', { timeout: 30_000 })
  await clickCloudControl(
    real.getByRole('button', { name: 'Use this identity for this target', exact: true })
  )
  await clickCloudControl(
    orcaPage.getByRole('dialog').getByRole('button', { name: 'Confirm identity', exact: true })
  )
  await expect(real).toContainText('Expected account: 000000000000')
  await clickCloudControl(real.getByRole('button', { name: 'Read resources', exact: true }))
  await expect(real.getByLabel('Real AWS resources')).toBeVisible()
  expect(charges()).toBe(0)
  const fetch = costs.getByRole('button', { name: 'Fetch Cost Explorer data', exact: true })
  await expect(fetch).toBeEnabled()
  await clickCloudControl(fetch)
  const dialog = orcaPage.getByRole('dialog')
  await expect(dialog).toContainText('000000000000')
  await expect(dialog).toContainText('fixture-profile')
  await expect(dialog).toContainText('UnblendedCost')
  await expect(dialog).toContainText('DAILY')
  await expect(dialog).toContainText('us-east-1')
  await expect(dialog).toContainText('May incur AWS API charges')
  expect(charges()).toBe(0)
  await clickCloudControl(dialog.getByRole('button', { name: 'Cancel', exact: true }))
  expect(charges()).toBe(0)
  await clickCloudControl(fetch)
  await clickCloudControl(dialog.getByRole('button', { name: 'Confirm paid read', exact: true }))
  await expect(costs).toContainText('1.25')
  await expect(costs).toContainText('USD')
  await expect(costs).toContainText('Estimated')
  // 9.5: a total that includes an estimated day is never shown as an actual total.
  await expect(costs).toContainText('Estimated total: 1.25 USD')
  await expect(costs).toContainText('not an invoice')
  await expect(costs).toContainText('Observed')
  expect(charges()).toBe(1)
  await orcaPage.reload()
  await expect(
    orcaPage.locator('.workspace-nav-item').filter({ hasText: 'Cloud' }).first()
  ).toBeVisible()
  await openBastionPage(orcaPage, 'Cloud')
  await orcaPage.evaluate(() => window.dispatchEvent(new Event('focus')))
  expect(charges()).toBe(1)
})
