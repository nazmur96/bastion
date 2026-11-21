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
      rmSync(join(seededRepoPath, 'config'), { recursive: true, force: true })
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

test('10.2 binds an existing bucket: a scoped policy in a new infra directory plus one app config example', async ({
  orcaPage,
  seededRepoPath
}) => {
  test.skip(process.platform === 'win32', 'POSIX controlled Terraform fixture')
  writeFileSync(join(seededRepoPath, 'mise.toml'), '[tools]\nterraform = "1.16.5"\n', {
    flag: 'wx'
  })
  mkdirSync(join(seededRepoPath, 'config'), { recursive: true })
  writeFileSync(join(seededRepoPath, 'config/app.yaml'), 'app: checkout\n')
  await openBastionPage(orcaPage, 'Recipes')
  const form = orcaPage.getByTestId('recipe-object-storage-binding')
  await form.getByLabel('Existing bucket').fill('orders-assets')
  await expect(form.getByLabel('Config variable')).toHaveValue('ORDERS_ASSETS_BUCKET')
  await form.getByLabel('Config variable').fill('ORDER_BUCKET')
  await clickCloudControl(form.getByRole('button', { name: 'Create binding files', exact: true }))
  const dialog = orcaPage.getByRole('dialog')
  await expect(dialog).toContainText('infra/orders-assets-access/main.tf')
  await expect(dialog).toContainText('config/ORDER_BUCKET.env.example')
  await clickCloudControl(dialog.getByRole('button', { name: 'Create binding files', exact: true }))

  const card = orcaPage.getByTestId('recipe-directory')
  await expect(card).toContainText(
    'Also created for the application: config/ORDER_BUCKET.env.example'
  )
  expect(readFileSync(join(seededRepoPath, 'config/ORDER_BUCKET.env.example'), 'utf8')).toContain(
    'ORDER_BUCKET=orders-assets'
  )
  const main = readFileSync(join(seededRepoPath, 'infra/orders-assets-access/main.tf'), 'utf8')
  expect(main).toContain('data "aws_s3_bucket" "this"')
  expect(main).not.toContain('resource "aws_s3_bucket"')
  // The application's own configuration is untouched.
  expect(readFileSync(join(seededRepoPath, 'config/app.yaml'), 'utf8')).toBe('app: checkout\n')
  await clickCloudControl(card.getByRole('button', { name: 'Validate', exact: true }))
  await expect(orcaPage.getByTestId('recipe-validation')).toContainText('validate: passed')
})

test('10.3 creates a secret reference with no value and a scoped read policy', async ({
  orcaPage,
  seededRepoPath
}) => {
  test.skip(process.platform === 'win32', 'POSIX controlled Terraform fixture')
  writeFileSync(join(seededRepoPath, 'mise.toml'), '[tools]\nterraform = "1.16.5"\n', {
    flag: 'wx'
  })
  await openBastionPage(orcaPage, 'Recipes')
  const form = orcaPage.getByTestId('recipe-secret-reference')
  await form.getByLabel('Secret name').fill('checkout/db-password')
  await expect(form.getByLabel('Config variable')).toHaveValue('CHECKOUT_DB_PASSWORD_SECRET')
  await form.getByLabel('Recovery window (days: 0 or 7–30)').fill('3')
  await expect(form).toContainText('recoveryWindowDays')
  await expect(
    form.getByRole('button', { name: 'Create secret reference files', exact: true })
  ).toBeDisabled()
  await form.getByLabel('Recovery window (days: 0 or 7–30)').fill('7')
  await clickCloudControl(
    form.getByRole('button', { name: 'Create secret reference files', exact: true })
  )
  const dialog = orcaPage.getByRole('dialog')
  await expect(dialog).toContainText('infra/checkout-db-password-secret/main.tf')
  await clickCloudControl(
    dialog.getByRole('button', { name: 'Create secret reference files', exact: true })
  )
  await expect(orcaPage.getByTestId('recipe-directory')).toContainText(
    'config/CHECKOUT_DB_PASSWORD_SECRET.env.example'
  )
  const main = readFileSync(
    join(seededRepoPath, 'infra/checkout-db-password-secret/main.tf'),
    'utf8'
  )
  expect(main).toContain('resource "aws_secretsmanager_secret" "this"')
  expect(main).not.toMatch(/secret_string|aws_secretsmanager_secret_version/)
})

test('10.4/10.5 recipes create files; Docker-backed resources are validate-only on Floci', async ({
  orcaPage,
  seededRepoPath
}) => {
  test.skip(process.platform === 'win32', 'POSIX controlled Terraform fixture')
  writeFileSync(join(seededRepoPath, 'mise.toml'), '[tools]\nterraform = "1.16.5"\n', {
    flag: 'wx'
  })
  await openBastionPage(orcaPage, 'Recipes')
  const create = async (testId: string, fill: Record<string, string>, label: string) => {
    const form = orcaPage.getByTestId(testId)
    for (const [field, value] of Object.entries(fill)) {
      await form.getByLabel(field, { exact: true }).fill(value)
    }
    await clickCloudControl(form.getByRole('button', { name: label, exact: true }))
    await clickCloudControl(
      orcaPage.getByRole('dialog').getByRole('button', { name: label, exact: true })
    )
    await expect(orcaPage.getByTestId('recipe-directory')).toBeVisible()
  }

  await create(
    'recipe-container-registry',
    { 'Repository name': 'checkout/api' },
    'Create registry files'
  )
  const card = orcaPage.getByTestId('recipe-directory')
  await expect(card.getByTestId('recipe-floci-unsupported')).toContainText('aws_ecr_repository')
  await expect(card.getByRole('button', { name: 'Apply to Floci…', exact: true })).toBeDisabled()
  expect(
    readFileSync(join(seededRepoPath, 'infra/checkout-api-registry/main.tf'), 'utf8')
  ).toContain('image_tag_mutability = "IMMUTABLE"')

  await clickCloudControl(orcaPage.getByRole('button', { name: 'New recipe', exact: true }))
  await create('recipe-workload-role', { 'Role name': 'checkout-task' }, 'Create role files')
  expect(readFileSync(join(seededRepoPath, 'infra/checkout-task-role/main.tf'), 'utf8')).toContain(
    'aws:SourceAccount'
  )

  await clickCloudControl(orcaPage.getByRole('button', { name: 'New recipe', exact: true }))
  await create(
    'recipe-postgres-database',
    { 'Instance identifier': 'orders-db' },
    'Create database files'
  )
  const main = readFileSync(join(seededRepoPath, 'infra/orders-db/main.tf'), 'utf8')
  expect(main).toContain('data "aws_db_instance" "this"')
  expect(main).not.toMatch(/resource "aws_db_instance"|password\s*=/)
})

test('14.7 queue, topic and table recipes create files, a config example each, and stay Floci-deliverable', async ({
  orcaPage,
  seededRepoPath
}) => {
  test.skip(process.platform === 'win32', 'POSIX controlled Terraform fixture')
  writeFileSync(join(seededRepoPath, 'mise.toml'), '[tools]\nterraform = "1.16.5"\n', {
    flag: 'wx'
  })
  await openBastionPage(orcaPage, 'Recipes')
  const card = orcaPage.getByTestId('recipe-directory')
  const create = async (testId: string, fill: Record<string, string>, label: string) => {
    const form = orcaPage.getByTestId(testId)
    for (const [field, value] of Object.entries(fill)) {
      await form.getByLabel(field, { exact: true }).fill(value)
    }
    await clickCloudControl(form.getByRole('button', { name: label, exact: true }))
    await clickCloudControl(
      orcaPage.getByRole('dialog').getByRole('button', { name: label, exact: true })
    )
    await expect(card).toBeVisible()
    await expect(card.getByTestId('recipe-floci-unsupported')).toHaveCount(0)
  }
  await create('recipe-message-queue', { 'Queue name': 'orders' }, 'Create queue files')
  await expect(card).toContainText('config/ORDERS_QUEUE_NAME.env.example')
  const queue = readFileSync(join(seededRepoPath, 'infra/orders-queue/main.tf'), 'utf8')
  expect(queue).toContain('deadLetterTargetArn')
  expect(queue).toContain('aws:SecureTransport')

  await clickCloudControl(orcaPage.getByRole('button', { name: 'New recipe', exact: true }))
  await create('recipe-notification-topic', { 'Topic name': 'order-events' }, 'Create topic files')
  expect(
    readFileSync(join(seededRepoPath, 'config/ORDER_EVENTS_TOPIC_NAME.env.example'), 'utf8')
  ).toContain('ORDER_EVENTS_TOPIC_NAME=order-events')

  await clickCloudControl(orcaPage.getByRole('button', { name: 'New recipe', exact: true }))
  await create(
    'recipe-key-value-table',
    {
      'Table name': 'orders',
      'Partition key': 'id',
      'Infra directory (new)': 'infra/orders-table'
    },
    'Create table files'
  )
  const tfvars = readFileSync(join(seededRepoPath, 'infra/orders-table/terraform.tfvars'), 'utf8')
  expect(tfvars).toMatch(/deletion_protection\s+= true/)
  expect(tfvars).toMatch(/sort_key\s+= null/)
})

test('14.6 domain and HTTPS recipe connects to a zone and creates a DNS-validated certificate', async ({
  orcaPage,
  seededRepoPath
}) => {
  test.skip(process.platform === 'win32', 'POSIX controlled Terraform fixture')
  writeFileSync(join(seededRepoPath, 'mise.toml'), '[tools]\nterraform = "1.16.5"\n', {
    flag: 'wx'
  })
  await openBastionPage(orcaPage, 'Recipes')
  const form = orcaPage.getByTestId('recipe-domain-https')
  await form.getByLabel('Hosted zone', { exact: true }).fill('example.com')
  await form.getByLabel('Application name', { exact: true }).fill('app.example.com')
  await form.getByLabel('Target hostname', { exact: true }).fill('lb.example.net')
  await clickCloudControl(form.getByRole('button', { name: 'Create domain files', exact: true }))
  await clickCloudControl(
    orcaPage.getByRole('dialog').getByRole('button', { name: 'Create domain files', exact: true })
  )
  const card = orcaPage.getByTestId('recipe-directory')
  await expect(card).toContainText('config/APP_PUBLIC_URL.env.example')
  const main = readFileSync(join(seededRepoPath, 'infra/app-example-com-https/main.tf'), 'utf8')
  expect(main).toContain('data "aws_route53_zone" "this"')
  expect(main).toContain('aws_acm_certificate_validation')
})
