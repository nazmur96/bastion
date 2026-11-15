import { describe, expect, it } from 'vitest'
import { renderSecretReference, secretReferenceSchema } from './secret-reference'

const input = {
  mode: 'create',
  secretName: 'checkout/db-password',
  recoveryWindowDays: 7,
  directory: 'infra/checkout-secret',
  roleName: null,
  configVariable: 'DB_PASSWORD_SECRET',
  configDirectory: 'config',
  tags: { owner: 'team', project: 'checkout' }
}
const text = (files: { path: string; content: string }[], name: string) =>
  files.find((file) => file.path.endsWith(name))?.content ?? ''

describe('secret reference recipe', () => {
  it('creates an empty secret and a read policy scoped to it, never a value', () => {
    const files = renderSecretReference(secretReferenceSchema.parse(input))
    const main = text(files, 'main.tf')
    expect(main).toContain('resource "aws_secretsmanager_secret" "this"')
    expect(main).not.toMatch(/aws_secretsmanager_secret_version|secret_string|random_password/)
    expect(main).toContain('resources = [local.secret_arn]')
    expect(main).toContain('"secretsmanager:GetSecretValue", "secretsmanager:DescribeSecret"')
    expect(main).not.toContain('secretsmanager:*')
    expect(text(files, 'DB_PASSWORD_SECRET.env.example')).toContain(
      'DB_PASSWORD_SECRET=checkout/db-password'
    )
    expect(text(files, 'terraform.tfvars')).toContain('recovery_window_in_days = 7')
  })
  it('connects to an existing secret without creating one', () => {
    const files = renderSecretReference(secretReferenceSchema.parse({ ...input, mode: 'existing' }))
    const main = text(files, 'main.tf')
    expect(main).toContain('data "aws_secretsmanager_secret" "this"')
    expect(main).not.toContain('resource "aws_secretsmanager_secret"')
  })
  it.each([
    ['window between 1 and 6', { recoveryWindowDays: 3 }],
    ['secret name with space', { secretName: 'a b' }],
    ['secret name with quote', { secretName: 'a"b' }],
    ['template in tag', { tags: { owner: '${x}', project: '' } }],
    ['config in infra dir', { configDirectory: 'infra/checkout-secret' }]
  ])('refuses %s', (_label, change) => {
    expect(secretReferenceSchema.safeParse({ ...input, ...change }).success).toBe(false)
  })
})
