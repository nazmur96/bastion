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

// A controlled Terraform: it reports the pinned version and records every call. No real
// Terraform, provider download or emulator is used here.
const test = base.extend<{ terraformFixture: { data: string; log: string } }>({
  terraformFixture: async ({ seededRepoPath }, provide) => {
    const data = mkdtempSync(join(tmpdir(), 'recipe-ui-tf-')),
      bin = join(data, 'installs', 'terraform', '1.16.5'),
      log = join(data, 'calls.jsonl')
    mkdirSync(bin, { recursive: true })
    writeFileSync(
      join(bin, 'terraform'),
      `#!${process.execPath}\nconst a=process.argv.slice(2);require('fs').appendFileSync(${JSON.stringify(log)},JSON.stringify(a)+'\\n');if(a[0]==='version'){console.log(JSON.stringify({terraform_version:'1.16.5'}))}\n`,
      { mode: 0o700 }
    )
    chmodSync(join(bin, 'terraform'), 0o700)
    try {
      await provide({ data, log })
    } finally {
      rmSync(join(seededRepoPath, 'mise.toml'), { force: true })
      rmSync(join(seededRepoPath, 'infra'), { recursive: true, force: true })
      rmSync(data, { recursive: true, force: true })
    }
  },
  orcaAppExtraEnv: async ({ terraformFixture }, provide) => {
    await provide({
      MISE_DATA_DIR: terraformFixture.data,
      MISE_AUTO_INSTALL: '0',
      MISE_OFFLINE: '1'
    })
  }
})

test('10.1 creates an object storage recipe as ordinary source and validates it on the owner', async ({
  orcaPage,
  seededRepoPath,
  terraformFixture
}) => {
  test.skip(process.platform === 'win32', 'POSIX controlled Terraform fixture')
  // The project's Terraform pin; written after startup, read fresh by each recipe operation.
  writeFileSync(join(seededRepoPath, 'mise.toml'), '[tools]\nterraform = "1.16.5"\n', {
    flag: 'wx'
  })
  await openBastionPage(orcaPage, 'Recipes')
  const form = orcaPage.getByTestId('recipe-object-storage')
  await expect(form).toBeVisible()
  await form.getByLabel('Bucket name').fill('orders-assets')
  await form.getByLabel('Owner tag').fill('platform-team')
  await form.getByLabel('Project tag').fill('checkout')
  await clickCloudControl(form.getByRole('button', { name: 'Create files', exact: true }))
  const dialog = orcaPage.getByRole('dialog')
  await expect(dialog).toContainText('infra/orders-assets/main.tf')
  await expect(dialog).toContainText('never overwritten')
  await clickCloudControl(dialog.getByRole('button', { name: 'Create files', exact: true }))

  const card = orcaPage.getByTestId('recipe-directory')
  await expect(card).toContainText('infra/orders-assets/versions.tf')
  const main = readFileSync(join(seededRepoPath, 'infra/orders-assets/main.tf'), 'utf8')
  expect(main).toContain('restrict_public_buckets = true')
  expect(
    readFileSync(join(seededRepoPath, 'infra/orders-assets/terraform.tfvars'), 'utf8')
  ).toMatch(/owner\s+= "platform-team"/)

  await clickCloudControl(card.getByRole('button', { name: 'Validate', exact: true }))
  const validation = orcaPage.getByTestId('recipe-validation')
  await expect(validation).toContainText('Validated with Terraform 1.16.5')
  await expect(validation).toContainText('validate: passed')
  const calls = readFileSync(terraformFixture.log, 'utf8')
  expect(calls).toContain('"-backend=false"')
  // Validation ran in Bastion's private copy, so the project gets no .terraform directory.
  expect(existsSync(join(seededRepoPath, 'infra/orders-assets/.terraform'))).toBe(false)
  // Without a selected Floci AWS target there is nothing to apply to.
  await expect(card.getByRole('button', { name: 'Apply to Floci…', exact: true })).toBeDisabled()

  // A second recipe into the same directory is refused and leaves the engineer's files alone.
  writeFileSync(join(seededRepoPath, 'infra/orders-assets/main.tf'), `${main}# my edit\n`)
  await clickCloudControl(orcaPage.getByRole('button', { name: 'New recipe', exact: true }))
  await form.getByLabel('Bucket name').fill('orders-assets')
  await clickCloudControl(form.getByRole('button', { name: 'Create files', exact: true }))
  await clickCloudControl(
    orcaPage.getByRole('dialog').getByRole('button', { name: 'Create files', exact: true })
  )
  await expect(form).toContainText('existing files are never overwritten')
  expect(readFileSync(join(seededRepoPath, 'infra/orders-assets/main.tf'), 'utf8')).toContain(
    '# my edit'
  )
})
