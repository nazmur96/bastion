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
 * Fork: Step 14.7 key-value table. An on-demand DynamoDB table with point-in-time recovery and
 * deletion protection by default, plus scoped reader and writer policies for existing roles.
 */
const attribute = z.string().regex(/^[A-Za-z0-9_.-]{1,255}$/)
const roleName = z
  .string()
  .regex(/^[\w+=,.@-]{1,64}$/)
  .nullable()
export const keyValueTableSchema = z
  .object({
    name: z.string().regex(/^[A-Za-z0-9_.-]{3,255}$/),
    partitionKey: attribute,
    partitionKeyType: z.enum(['S', 'N', 'B']),
    sortKey: attribute.nullable(),
    sortKeyType: z.enum(['S', 'N', 'B']),
    pointInTimeRecovery: z.boolean(),
    deletionProtection: z.boolean(),
    readerRole: roleName,
    writerRole: roleName,
    directory: recipeDirectorySchema,
    configVariable: z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/),
    configDirectory: recipeDirectorySchema,
    tags: z.object({ owner: recipeTagSchema, project: recipeTagSchema }).strict()
  })
  .strict()
  .refine((input) => input.sortKey !== input.partitionKey, {
    message: 'The sort key must differ from the partition key.'
  })
  .refine((input) => input.configDirectory !== input.directory, {
    message: 'The application config directory must differ from the infra directory.'
  })
export type KeyValueTable = z.infer<typeof keyValueTableSchema>

const VARIABLES = `variable "name" {
  description = "Table name."
  type        = string
}

variable "partition_key" {
  description = "Partition (hash) key attribute name."
  type        = string
}

variable "partition_key_type" {
  description = "S, N or B."
  type        = string
}

variable "sort_key" {
  description = "Sort (range) key attribute name, or null."
  type        = string
  default     = null
}

variable "sort_key_type" {
  description = "S, N or B; used only with a sort key."
  type        = string
  default     = "S"
}

variable "point_in_time_recovery" {
  description = "Continuous backups for the last 35 days."
  type        = bool
  default     = true
}

variable "deletion_protection" {
  description = "Refuse table deletion until this is turned off and applied."
  type        = bool
  default     = true
}

variable "reader_role_name" {
  description = "Existing IAM role that reads the table, or null."
  type        = string
  default     = null
}

variable "writer_role_name" {
  description = "Existing IAM role that reads and writes the table, or null."
  type        = string
  default     = null
}

${TAGS_VARIABLE}`
const MAIN = `resource "aws_dynamodb_table" "this" {
  name                        = var.name
  billing_mode                = "PAY_PER_REQUEST"
  hash_key                    = var.partition_key
  range_key                   = var.sort_key
  deletion_protection_enabled = var.deletion_protection
  tags                        = var.tags

  attribute {
    name = var.partition_key
    type = var.partition_key_type
  }

  dynamic "attribute" {
    for_each = var.sort_key == null ? [] : [var.sort_key]
    content {
      name = attribute.value
      type = var.sort_key_type
    }
  }

  point_in_time_recovery {
    enabled = var.point_in_time_recovery
  }
}

locals {
  table_resources = [aws_dynamodb_table.this.arn, "\${aws_dynamodb_table.this.arn}/index/*"]
  read_actions = [
    "dynamodb:GetItem",
    "dynamodb:BatchGetItem",
    "dynamodb:Query",
    "dynamodb:Scan",
    "dynamodb:DescribeTable"
  ]
  write_actions = [
    "dynamodb:PutItem",
    "dynamodb:UpdateItem",
    "dynamodb:DeleteItem",
    "dynamodb:BatchWriteItem"
  ]
}

data "aws_iam_policy_document" "reader" {
  statement {
    sid       = "Read"
    actions   = local.read_actions
    resources = local.table_resources
  }
}

data "aws_iam_policy_document" "writer" {
  statement {
    sid       = "ReadWrite"
    actions   = concat(local.read_actions, local.write_actions)
    resources = local.table_resources
  }
}

resource "aws_iam_policy" "reader" {
  name        = "\${var.name}-reader"
  description = "Read \${var.name}"
  policy      = data.aws_iam_policy_document.reader.json
  tags        = var.tags
}

resource "aws_iam_policy" "writer" {
  name        = "\${var.name}-writer"
  description = "Read and write \${var.name}"
  policy      = data.aws_iam_policy_document.writer.json
  tags        = var.tags
}

resource "aws_iam_role_policy_attachment" "reader" {
  count      = var.reader_role_name == null ? 0 : 1
  role       = var.reader_role_name
  policy_arn = aws_iam_policy.reader.arn
}

resource "aws_iam_role_policy_attachment" "writer" {
  count      = var.writer_role_name == null ? 0 : 1
  role       = var.writer_role_name
  policy_arn = aws_iam_policy.writer.arn
}
`
const OUTPUTS = `output "table_name" {
  value = aws_dynamodb_table.this.name
}

output "table_arn" {
  value = aws_dynamodb_table.this.arn
}

output "reader_policy_arn" {
  value = aws_iam_policy.reader.arn
}

output "writer_policy_arn" {
  value = aws_iam_policy.writer.arn
}
`

export function renderKeyValueTable(input: KeyValueTable): RecipeFile[] {
  return recipeFiles(
    input.directory,
    {
      '.gitignore': GITIGNORE,
      'main.tf': MAIN,
      'outputs.tf': OUTPUTS,
      'provider.tf': PROVIDER_TF,
      'terraform.tfvars': tfvarsWithTags(
        [
          ['name', JSON.stringify(input.name)],
          ['partition_key', JSON.stringify(input.partitionKey)],
          ['partition_key_type', JSON.stringify(input.partitionKeyType)],
          ['sort_key', hclString(input.sortKey)],
          ['sort_key_type', JSON.stringify(input.sortKeyType)],
          ['point_in_time_recovery', String(input.pointInTimeRecovery)],
          ['deletion_protection', String(input.deletionProtection)],
          ['reader_role_name', hclString(input.readerRole)],
          ['writer_role_name', hclString(input.writerRole)]
        ],
        input.tags
      ),
      'variables.tf': VARIABLES,
      'versions.tf': VERSIONS_TF
    },
    [
      {
        path: `${input.configDirectory}/${input.configVariable}.env.example`,
        content: `# Generated by Bastion. The table this application uses; access is granted by the
# reader and writer IAM policies in ${input.directory}. Copy into your runtime configuration.
${input.configVariable}=${input.name}
`
      }
    ]
  )
}
