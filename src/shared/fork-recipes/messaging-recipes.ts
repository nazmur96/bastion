import { z } from 'zod'
import { recipeDirectorySchema, recipeTagSchema, type RecipeFile } from './object-storage-recipe'
import {
  GITIGNORE,
  PROVIDER_TF,
  TAGS_VARIABLE,
  VERSIONS_TF,
  hclString,
  recipeFiles,
  tfvarsWithTags
} from './recipe-hcl'

/**
 * Fork: Step 14.7 messaging recipes. A queue with a dead-letter queue, and a topic. Each has
 * scoped producer/consumer policies, optionally attached to existing roles, and an application
 * config example. Ordinary Terraform the engineer owns afterwards.
 */
const roleName = z
  .string()
  .regex(/^[\w+=,.@-]{1,64}$/)
  .nullable()
const shared = {
  directory: recipeDirectorySchema,
  configVariable: z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/),
  configDirectory: recipeDirectorySchema,
  tags: z.object({ owner: recipeTagSchema, project: recipeTagSchema }).strict()
}
const separateConfig = {
  message: 'The application config directory must differ from the infra directory.'
}
export const messageQueueSchema = z
  .object({
    // Room for the "-dlq" suffix within SQS's 80 characters.
    name: z.string().regex(/^[A-Za-z0-9_-]{1,76}$/),
    visibilityTimeoutSeconds: z.number().int().min(0).max(43200),
    retentionDays: z.number().int().min(1).max(14),
    maxReceiveCount: z.number().int().min(1).max(1000),
    producerRole: roleName,
    consumerRole: roleName,
    ...shared
  })
  .strict()
  .refine((input) => input.configDirectory !== input.directory, separateConfig)
export type MessageQueue = z.infer<typeof messageQueueSchema>
export const notificationTopicSchema = z
  .object({
    name: z.string().regex(/^[A-Za-z0-9_-]{1,256}$/),
    publisherRole: roleName,
    ...shared
  })
  .strict()
  .refine((input) => input.configDirectory !== input.directory, separateConfig)
export type NotificationTopic = z.infer<typeof notificationTopicSchema>

/** `orders-events` → `ORDERS_EVENTS_QUEUE_NAME`, a suggestion the engineer may change. */
export function suggestedResourceVariable(name: string, suffix: string): string {
  const base = name
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  return `${/^[A-Z]/.test(base) ? base : `R_${base}`}_${suffix}`.slice(0, 64)
}
const roleVariable = (name: string, who: string) => `variable "${name}" {
  description = "Existing IAM role for the ${who}, or null."
  type        = string
  default     = null
}
`
const attachment = (
  resource: string,
  variable: string,
  policy: string
) => `resource "aws_iam_role_policy_attachment" "${resource}" {
  count      = var.${variable} == null ? 0 : 1
  role       = var.${variable}
  policy_arn = aws_iam_policy.${policy}.arn
}
`
/**
 * Deny any request to the resource that does not use TLS. Real AWS accepts only the resource's
 * own service actions here: SQS takes `sqs:*`, SNS refuses even `sns:*` and needs them listed.
 */
const denyInsecure = (resource: string, actions: string) => `  statement {
    sid     = "DenyInsecureTransport"
    effect  = "Deny"
    actions = ${actions}
    principals {
      type        = "*"
      identifiers = ["*"]
    }
    resources = [${resource}]
    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }`

const SNS_TOPIC_ACTIONS = `[
      "sns:Publish",
      "sns:Subscribe",
      "sns:Receive",
      "sns:GetTopicAttributes",
      "sns:SetTopicAttributes",
      "sns:AddPermission",
      "sns:RemovePermission",
      "sns:DeleteTopic",
      "sns:ListSubscriptionsByTopic"
    ]`

const QUEUE_VARIABLES = `variable "name" {
  description = "Queue name; the dead-letter queue is named <name>-dlq."
  type        = string
}

variable "visibility_timeout_seconds" {
  description = "How long a received message stays hidden from other consumers."
  type        = number
}

variable "retention_days" {
  description = "How long an unprocessed message is kept (1-14 days)."
  type        = number
}

variable "max_receive_count" {
  description = "Receives before a message moves to the dead-letter queue."
  type        = number
}

${roleVariable('producer_role_name', 'producer')}
${roleVariable('consumer_role_name', 'consumer')}
${TAGS_VARIABLE}`
const QUEUE_MAIN = `resource "aws_sqs_queue" "dlq" {
  name                      = "\${var.name}-dlq"
  message_retention_seconds = 1209600
  sqs_managed_sse_enabled   = true
  tags                      = var.tags
}

resource "aws_sqs_queue" "this" {
  name                       = var.name
  visibility_timeout_seconds = var.visibility_timeout_seconds
  message_retention_seconds  = var.retention_days * 86400
  sqs_managed_sse_enabled    = true
  tags                       = var.tags
  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.dlq.arn
    maxReceiveCount     = var.max_receive_count
  })
}

# Only this queue may use the dead-letter queue.
resource "aws_sqs_queue_redrive_allow_policy" "dlq" {
  queue_url = aws_sqs_queue.dlq.id
  redrive_allow_policy = jsonencode({
    redrivePermission = "byQueue"
    sourceQueueArns   = [aws_sqs_queue.this.arn]
  })
}

data "aws_iam_policy_document" "transport" {
${denyInsecure('aws_sqs_queue.this.arn', '["sqs:*"]')}
}

resource "aws_sqs_queue_policy" "this" {
  queue_url = aws_sqs_queue.this.id
  policy    = data.aws_iam_policy_document.transport.json
}

data "aws_iam_policy_document" "producer" {
  statement {
    sid       = "Send"
    actions   = ["sqs:SendMessage", "sqs:GetQueueUrl", "sqs:GetQueueAttributes"]
    resources = [aws_sqs_queue.this.arn]
  }
}

data "aws_iam_policy_document" "consumer" {
  statement {
    sid = "Receive"
    actions = [
      "sqs:ReceiveMessage",
      "sqs:DeleteMessage",
      "sqs:ChangeMessageVisibility",
      "sqs:GetQueueUrl",
      "sqs:GetQueueAttributes"
    ]
    resources = [aws_sqs_queue.this.arn]
  }
}

resource "aws_iam_policy" "producer" {
  name        = "\${var.name}-producer"
  description = "Send messages to \${var.name}"
  policy      = data.aws_iam_policy_document.producer.json
  tags        = var.tags
}

resource "aws_iam_policy" "consumer" {
  name        = "\${var.name}-consumer"
  description = "Receive and delete messages from \${var.name}"
  policy      = data.aws_iam_policy_document.consumer.json
  tags        = var.tags
}

${attachment('producer', 'producer_role_name', 'producer')}
${attachment('consumer', 'consumer_role_name', 'consumer')}`
const QUEUE_OUTPUTS = `output "queue_url" {
  value = aws_sqs_queue.this.id
}

output "queue_arn" {
  value = aws_sqs_queue.this.arn
}

output "dead_letter_queue_url" {
  value = aws_sqs_queue.dlq.id
}

output "producer_policy_arn" {
  value = aws_iam_policy.producer.arn
}

output "consumer_policy_arn" {
  value = aws_iam_policy.consumer.arn
}
`

const TOPIC_VARIABLES = `variable "name" {
  description = "Topic name."
  type        = string
}

${roleVariable('publisher_role_name', 'publisher')}
${TAGS_VARIABLE}`
const TOPIC_MAIN = `resource "aws_sns_topic" "this" {
  name              = var.name
  kms_master_key_id = "alias/aws/sns"
  tags              = var.tags
}

data "aws_iam_policy_document" "transport" {
${denyInsecure('aws_sns_topic.this.arn', SNS_TOPIC_ACTIONS)}
}

resource "aws_sns_topic_policy" "this" {
  arn    = aws_sns_topic.this.arn
  policy = data.aws_iam_policy_document.transport.json
}

data "aws_iam_policy_document" "publisher" {
  statement {
    sid       = "Publish"
    actions   = ["sns:Publish"]
    resources = [aws_sns_topic.this.arn]
  }
}

resource "aws_iam_policy" "publisher" {
  name        = "\${var.name}-publisher"
  description = "Publish to \${var.name}"
  policy      = data.aws_iam_policy_document.publisher.json
  tags        = var.tags
}

${attachment('publisher', 'publisher_role_name', 'publisher')}`
const TOPIC_OUTPUTS = `output "topic_arn" {
  value = aws_sns_topic.this.arn
}

output "publisher_policy_arn" {
  value = aws_iam_policy.publisher.arn
}
`

function configExample(
  input: { configVariable: string; configDirectory: string; directory: string },
  value: string,
  what: string
): RecipeFile {
  return {
    path: `${input.configDirectory}/${input.configVariable}.env.example`,
    content: `# Generated by Bastion. ${what}; access is granted by the IAM policies in
# ${input.directory}. Copy into your runtime configuration.
${input.configVariable}=${value}
`
  }
}

export function renderMessageQueue(input: MessageQueue): RecipeFile[] {
  return recipeFiles(
    input.directory,
    {
      '.gitignore': GITIGNORE,
      'main.tf': QUEUE_MAIN,
      'outputs.tf': QUEUE_OUTPUTS,
      'provider.tf': PROVIDER_TF,
      'terraform.tfvars': tfvarsWithTags(
        [
          ['name', JSON.stringify(input.name)],
          ['visibility_timeout_seconds', String(input.visibilityTimeoutSeconds)],
          ['retention_days', String(input.retentionDays)],
          ['max_receive_count', String(input.maxReceiveCount)],
          ['producer_role_name', hclString(input.producerRole)],
          ['consumer_role_name', hclString(input.consumerRole)]
        ],
        input.tags
      ),
      'variables.tf': QUEUE_VARIABLES,
      'versions.tf': VERSIONS_TF
    },
    [configExample(input, input.name, 'The queue this application uses (resolve its URL by name)')]
  )
}

export function renderNotificationTopic(input: NotificationTopic): RecipeFile[] {
  return recipeFiles(
    input.directory,
    {
      '.gitignore': GITIGNORE,
      'main.tf': TOPIC_MAIN,
      'outputs.tf': TOPIC_OUTPUTS,
      'provider.tf': PROVIDER_TF,
      'terraform.tfvars': tfvarsWithTags(
        [
          ['name', JSON.stringify(input.name)],
          ['publisher_role_name', hclString(input.publisherRole)]
        ],
        input.tags
      ),
      'variables.tf': TOPIC_VARIABLES,
      'versions.tf': VERSIONS_TF
    },
    [
      configExample(
        input,
        input.name,
        'The topic this application publishes to (its ARN is the topic_arn output)'
      )
    ]
  )
}
