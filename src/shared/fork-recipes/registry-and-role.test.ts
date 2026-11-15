import { describe, expect, it } from 'vitest'
import {
  containerRegistrySchema,
  renderContainerRegistry,
  renderWorkloadRole,
  workloadRoleSchema
} from './registry-and-role'

const text = (files: { path: string; content: string }[], name: string) =>
  files.find((file) => file.path.endsWith(name))?.content ?? ''
const tags = { owner: 'team', project: 'checkout' }

describe('container registry recipe', () => {
  const input = {
    name: 'checkout/api',
    keepImages: 20,
    scanOnPush: true,
    directory: 'infra/registry',
    tags
  }
  it('creates an immutable, scanned, encrypted repository with a retention rule', () => {
    const main = text(renderContainerRegistry(containerRegistrySchema.parse(input)), 'main.tf')
    expect(main).toContain('image_tag_mutability = "IMMUTABLE"')
    expect(main).toContain('force_delete         = false')
    expect(main).toContain('encryption_type = "AES256"')
    expect(main).toContain('countNumber = var.keep_images')
  })
  it.each([
    ['uppercase name', { name: 'Checkout' }],
    ['no images kept', { keepImages: 0 }],
    ['quote in name', { name: 'a"b' }]
  ])('refuses %s', (_label, change) => {
    expect(containerRegistrySchema.safeParse({ ...input, ...change }).success).toBe(false)
  })
})

describe('workload role recipe', () => {
  const input = {
    name: 'checkout-task',
    service: 'ecs-tasks.amazonaws.com',
    directory: 'infra/role',
    tags
  }
  it('trusts one service for this account only and grants nothing by itself', () => {
    const main = text(renderWorkloadRole(workloadRoleSchema.parse(input)), 'main.tf')
    expect(main).toContain('variable = "aws:SourceAccount"')
    expect(main).toContain('identifiers = [var.service]')
    expect(main).not.toMatch(/aws_iam_role_policy\b|"\*"|AdministratorAccess/)
  })
  it.each([
    ['any service', { service: 'ec2.amazonaws.com' }],
    ['wildcard name', { name: '*' }]
  ])('refuses %s', (_label, change) => {
    expect(workloadRoleSchema.safeParse({ ...input, ...change }).success).toBe(false)
  })
})
