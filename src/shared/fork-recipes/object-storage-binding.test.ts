import { describe, expect, it } from 'vitest'
import {
  objectStorageBindingSchema,
  renderObjectStorageBinding,
  suggestedConfigVariable
} from './object-storage-binding'

const input = {
  bucket: 'orders-assets',
  directory: 'infra/orders-assets-access',
  access: 'read-write',
  roleName: null,
  configVariable: 'ORDER_BUCKET',
  configDirectory: 'config',
  tags: { owner: 'platform-team', project: 'checkout' }
}

describe('object storage binding', () => {
  it('connects to an existing bucket and writes the policy plus one app config example', () => {
    const files = renderObjectStorageBinding(objectStorageBindingSchema.parse(input))
    expect(files.map((file) => file.path)).toEqual([
      'infra/orders-assets-access/.gitignore',
      'infra/orders-assets-access/main.tf',
      'infra/orders-assets-access/outputs.tf',
      'infra/orders-assets-access/provider.tf',
      'infra/orders-assets-access/terraform.tfvars',
      'infra/orders-assets-access/variables.tf',
      'infra/orders-assets-access/versions.tf',
      'config/ORDER_BUCKET.env.example'
    ])
    const text = Object.fromEntries(
      files.map((file) => [file.path.split('/').at(-1), file.content])
    )
    expect(text['main.tf']).toContain('data "aws_s3_bucket" "this"')
    expect(text['main.tf']).not.toContain('resource "aws_s3_bucket"')
    expect(text['main.tf']).toContain('resources = ["${data.aws_s3_bucket.this.arn}/*"]')
    expect(text['main.tf']).toContain('count      = var.role_name == null ? 0 : 1')
    expect(text['terraform.tfvars']).toContain('access      = "read-write"')
    expect(text['terraform.tfvars']).toContain('role_name   = null')
    expect(text['ORDER_BUCKET.env.example']).toContain('ORDER_BUCKET=orders-assets')
    expect(files.map((file) => file.content).join('\n')).not.toMatch(
      /endpoint|access_key|secret_key|skip_|127\.0\.0\.1|localhost|s3:\*/
    )
  })
  it('passes an existing role name as a literal', () => {
    const files = renderObjectStorageBinding(
      objectStorageBindingSchema.parse({ ...input, roleName: 'checkout-task' })
    )
    expect(files.find((file) => file.path.endsWith('terraform.tfvars'))?.content).toContain(
      'role_name   = "checkout-task"'
    )
  })
  it.each([
    ['wildcard role', { roleName: '*' }],
    ['lowercase variable', { configVariable: 'order_bucket' }],
    ['variable with equals', { configVariable: 'A=B' }],
    ['unknown access', { access: 'admin' }],
    ['config inside infra dir', { configDirectory: 'infra/orders-assets-access' }],
    ['template in tag', { tags: { owner: '${x}', project: '' } }]
  ])('refuses %s', (_label, change) => {
    expect(objectStorageBindingSchema.safeParse({ ...input, ...change }).success).toBe(false)
  })
  it('suggests an uppercase config variable from the bucket name', () => {
    expect(suggestedConfigVariable('orders-assets')).toBe('ORDERS_ASSETS_BUCKET')
    expect(suggestedConfigVariable('logs.bucket')).toBe('LOGS_BUCKET')
    expect(suggestedConfigVariable('2024-data')).toBe('BUCKET_2024_DATA_BUCKET')
  })
})
