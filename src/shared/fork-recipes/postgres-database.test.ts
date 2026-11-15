import { describe, expect, it } from 'vitest'
import { postgresDatabaseSchema, renderPostgresDatabase } from './postgres-database'

const input = {
  mode: 'create',
  identifier: 'orders-db',
  databaseName: 'orders',
  engineVersion: '17',
  instanceClass: 'db.t4g.micro',
  allocatedStorage: 20,
  vpcId: 'vpc-0123456789abcdef0',
  subnetIds: ['subnet-0123456789abcdef0', 'subnet-0123456789abcdef1'],
  allowedCidrs: ['10.0.0.0/16'],
  deletionProtection: true,
  skipFinalSnapshot: false,
  backupRetentionDays: 7,
  directory: 'infra/orders-db',
  roleName: null,
  configPrefix: 'ORDERS_DB',
  configDirectory: 'config',
  tags: { owner: 'team', project: 'checkout' }
}
const text = (files: { path: string; content: string }[], name: string) =>
  files.find((file) => file.path.endsWith(name))?.content ?? ''

describe('PostgreSQL recipe', () => {
  it('creates a private, encrypted instance whose password RDS manages', () => {
    const files = renderPostgresDatabase(postgresDatabaseSchema.parse(input))
    const main = text(files, 'main.tf')
    expect(main).toContain('manage_master_user_password = true')
    expect(main).toContain('publicly_accessible         = false')
    expect(main).toContain('storage_encrypted           = true')
    expect(main).toContain('from_port         = 5432')
    expect(main).not.toMatch(/\bpassword\s*=|random_password|0\.0\.0\.0\/0/)
    const all = files.map((file) => file.content).join('\n')
    expect(all).not.toMatch(/password\s*=\s*"/i)
    const app = text(files, 'ORDERS_DB.env.example')
    expect(app).toContain('ORDERS_DB_NAME=orders')
    expect(app).toContain('ORDERS_DB_SECRET_ARN=')
    expect(app).not.toMatch(/PASSWORD=/)
    expect(text(files, 'terraform.tfvars')).toContain(
      'subnet_ids            = ["subnet-0123456789abcdef0", "subnet-0123456789abcdef1"]'
    )
  })
  it('connects to an existing instance without creating anything', () => {
    const files = renderPostgresDatabase(
      postgresDatabaseSchema.parse({
        ...input,
        mode: 'existing',
        vpcId: null,
        subnetIds: [],
        allowedCidrs: []
      })
    )
    const main = text(files, 'main.tf')
    expect(main).toContain('data "aws_db_instance" "this"')
    expect(main).not.toMatch(/resource "aws_(db_instance|db_subnet_group|security_group)"/)
    expect(text(files, 'variables.tf')).not.toContain('subnet_ids')
  })
  it.each([
    ['open to the internet', { allowedCidrs: ['0.0.0.0/0'] }],
    ['a single subnet', { subnetIds: ['subnet-0123456789abcdef0'] }],
    ['no VPC when creating', { vpcId: null }],
    ['oversized class', { instanceClass: 'db.r6g.16xlarge' }],
    ['trailing hyphen identifier', { identifier: 'orders-' }],
    ['database name with hyphen', { databaseName: 'orders-db' }],
    ['template in tag', { tags: { owner: '${x}', project: '' } }]
  ])('refuses %s', (_label, change) => {
    expect(postgresDatabaseSchema.safeParse({ ...input, ...change }).success).toBe(false)
  })
})
