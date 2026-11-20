import { describe, expect, it } from 'vitest'
import {
  messageQueueSchema,
  notificationTopicSchema,
  renderMessageQueue,
  renderNotificationTopic,
  suggestedResourceVariable
} from './messaging-recipes'
import { keyValueTableSchema, renderKeyValueTable } from './key-value-table'

const shared = {
  directory: 'infra/orders-queue',
  configVariable: 'ORDERS_QUEUE_NAME',
  configDirectory: 'config',
  tags: { owner: 'team-a', project: 'shop' }
}
const queue = {
  name: 'orders',
  visibilityTimeoutSeconds: 30,
  retentionDays: 4,
  maxReceiveCount: 5,
  producerRole: 'api-task',
  consumerRole: null,
  ...shared
}
const table = {
  name: 'orders',
  partitionKey: 'id',
  partitionKeyType: 'S' as const,
  sortKey: 'createdAt',
  sortKeyType: 'N' as const,
  pointInTimeRecovery: true,
  deletionProtection: true,
  readerRole: null,
  writerRole: 'api-task',
  ...shared,
  directory: 'infra/orders-table',
  configVariable: 'ORDERS_TABLE_NAME'
}
const file = (files: { path: string; content: string }[], name: string) =>
  files.find((item) => item.path.endsWith(name))?.content ?? ''

describe('storage and queue recipes', () => {
  it('renders a queue with a DLQ, TLS-only access and separate scoped policies', () => {
    const files = renderMessageQueue(messageQueueSchema.parse(queue))
    expect(files.map((item) => item.path)).toEqual([
      'infra/orders-queue/.gitignore',
      'infra/orders-queue/main.tf',
      'infra/orders-queue/outputs.tf',
      'infra/orders-queue/provider.tf',
      'infra/orders-queue/terraform.tfvars',
      'infra/orders-queue/variables.tf',
      'infra/orders-queue/versions.tf',
      'config/ORDERS_QUEUE_NAME.env.example'
    ])
    const main = file(files, 'main.tf')
    expect(main).toContain('maxReceiveCount     = var.max_receive_count')
    expect(main).toContain('redrivePermission = "byQueue"')
    expect(main).toContain('values   = ["false"]')
    // Found on real AWS (Floci accepted it): a queue policy refuses a bare "*" action.
    expect(main).toContain('actions = ["sqs:*"]')
    expect(main).not.toMatch(/actions\s*=\s*\["\*"\]/)
    // The producer cannot receive or delete; the consumer cannot send.
    const producer = main.slice(main.indexOf('"producer" {'), main.indexOf('"consumer" {'))
    expect(producer).toContain('sqs:SendMessage')
    expect(producer).not.toMatch(/ReceiveMessage|DeleteMessage/)
    expect(main.slice(main.indexOf('"consumer" {'))).not.toContain('sqs:SendMessage')
    expect(file(files, 'terraform.tfvars')).toMatch(/producer_role_name\s+= "api-task"/)
    expect(file(files, 'terraform.tfvars')).toMatch(/consumer_role_name\s+= null/)
    expect(file(files, '.env.example')).toContain('ORDERS_QUEUE_NAME=orders')
  })
  it('renders an encrypted, TLS-only topic with a publish-only policy', () => {
    const files = renderNotificationTopic(
      notificationTopicSchema.parse({
        name: 'order-events',
        publisherRole: null,
        ...shared,
        directory: 'infra/order-events-topic',
        configVariable: 'ORDER_EVENTS_TOPIC_NAME'
      })
    )
    const main = file(files, 'main.tf')
    expect(main).toContain('kms_master_key_id = "alias/aws/sns"')
    expect(main).toContain('actions   = ["sns:Publish"]')
    expect(main).toContain('aws:SecureTransport')
    // SNS refuses "*" and even "sns:*" in a topic policy; the actions are listed.
    expect(main).not.toMatch(/actions\s*=\s*\["\*"\]|"sns:\*"/)
    expect(main).toContain('"sns:ListSubscriptionsByTopic"')
  })
  it('renders an on-demand table with PITR, deletion protection and index-scoped policies', () => {
    const files = renderKeyValueTable(keyValueTableSchema.parse(table))
    const main = file(files, 'main.tf')
    expect(main).toContain('billing_mode                = "PAY_PER_REQUEST"')
    expect(main).toContain('"${aws_dynamodb_table.this.arn}/index/*"')
    const tfvars = file(files, 'terraform.tfvars')
    expect(tfvars).toMatch(/sort_key\s+= "createdAt"/)
    expect(tfvars).toMatch(/deletion_protection\s+= true/)
    expect(tfvars).toMatch(/writer_role_name\s+= "api-task"/)
  })
  it('refuses input that could become HCL, and inconsistent choices', () => {
    for (const name of ['orders"; evil', 'a'.repeat(77), 'or ders', '${x}']) {
      expect(messageQueueSchema.safeParse({ ...queue, name }).success).toBe(false)
    }
    expect(messageQueueSchema.safeParse({ ...queue, retentionDays: 15 }).success).toBe(false)
    expect(
      messageQueueSchema.safeParse({ ...queue, configDirectory: queue.directory }).success
    ).toBe(false)
    expect(keyValueTableSchema.safeParse({ ...table, sortKey: 'id' }).success).toBe(false)
    expect(keyValueTableSchema.safeParse({ ...table, partitionKey: 'i"d' }).success).toBe(false)
    expect(keyValueTableSchema.safeParse({ ...table, billingMode: 'PROVISIONED' }).success).toBe(
      false
    )
  })
  it('suggests config variable names', () => {
    expect(suggestedResourceVariable('order-events', 'TOPIC_NAME')).toBe('ORDER_EVENTS_TOPIC_NAME')
    expect(suggestedResourceVariable('9lives', 'QUEUE_NAME')).toBe('R_9LIVES_QUEUE_NAME')
  })
})
