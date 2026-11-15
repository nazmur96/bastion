import { z } from 'zod'
import { recipeDirectorySchema, recipeTagSchema, type RecipeFile } from './object-storage-recipe'
import {
  GITIGNORE,
  PROVIDER_TF,
  ROLE_VARIABLE,
  TAGS_VARIABLE,
  VERSIONS_TF,
  hclString,
  recipeFiles,
  tfvarsWithTags
} from './recipe-hcl'

/**
 * Fork: PostgreSQL on RDS (Step 10.4). Connect to an existing instance, or create one whose
 * master password RDS keeps in Secrets Manager: no password reaches the source, Terraform
 * state or Bastion. Never publicly accessible; storage encrypted; access only from the given
 * CIDR blocks.
 */
const cidr = z
  .string()
  .regex(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/)
  .refine((value) => {
    const [address, bits] = value.split('/')
    return (
      address.split('.').every((part) => Number(part) <= 255) &&
      Number(bits) >= 8 &&
      Number(bits) <= 32
    )
  }, 'Use a private CIDR block no wider than /8; 0.0.0.0/0 is refused.')
export const postgresDatabaseSchema = z
  .object({
    mode: z.enum(['create', 'existing']),
    identifier: z
      .string()
      .regex(/^[a-z][a-z0-9-]{0,62}$/)
      .refine((value) => !value.includes('--') && !value.endsWith('-')),
    databaseName: z.string().regex(/^[a-z][a-z0-9_]{0,62}$/),
    engineVersion: z.enum(['16', '17']),
    instanceClass: z.enum(['db.t4g.micro', 'db.t4g.small', 'db.t4g.medium']),
    allocatedStorage: z.number().int().min(20).max(100),
    vpcId: z
      .string()
      .regex(/^vpc-[0-9a-f]{8,17}$/)
      .nullable(),
    subnetIds: z.array(z.string().regex(/^subnet-[0-9a-f]{8,17}$/)).max(6),
    allowedCidrs: z.array(cidr).max(5),
    deletionProtection: z.boolean(),
    skipFinalSnapshot: z.boolean(),
    backupRetentionDays: z.number().int().min(0).max(35),
    directory: recipeDirectorySchema,
    roleName: z
      .string()
      .regex(/^[\w+=,.@-]{1,64}$/)
      .nullable(),
    configPrefix: z.string().regex(/^[A-Z][A-Z0-9_]{0,40}$/),
    configDirectory: recipeDirectorySchema,
    tags: z.object({ owner: recipeTagSchema, project: recipeTagSchema }).strict()
  })
  .strict()
  .refine(
    (input) =>
      input.mode === 'existing' ||
      (input.vpcId !== null && input.subnetIds.length >= 2 && input.allowedCidrs.length >= 1),
    { message: 'Creating a database needs a VPC, at least two subnets and one allowed CIDR.' }
  )
  .refine((input) => input.configDirectory !== input.directory, {
    message: 'The application config directory must differ from the infra directory.'
  })
export type PostgresDatabase = z.infer<typeof postgresDatabaseSchema>

const CREATE_VARIABLES = `variable "identifier" {
  description = "RDS instance identifier."
  type        = string
}

variable "database_name" {
  description = "Initial database name."
  type        = string
}

variable "engine_version" {
  description = "PostgreSQL major version."
  type        = string
}

variable "instance_class" {
  description = "RDS instance class."
  type        = string
}

variable "allocated_storage" {
  description = "Storage in GiB (gp3)."
  type        = number
}

variable "vpc_id" {
  description = "VPC for the database security group."
  type        = string
}

variable "subnet_ids" {
  description = "Private subnets for the DB subnet group (at least two AZs)."
  type        = list(string)
}

variable "allowed_cidrs" {
  description = "CIDR blocks allowed to reach PostgreSQL on 5432."
  type        = list(string)
}

variable "deletion_protection" {
  description = "Refuse deletion while true."
  type        = bool
}

variable "skip_final_snapshot" {
  description = "Delete without a final snapshot."
  type        = bool
}

variable "backup_retention_days" {
  description = "Automated backup retention in days (0 disables)."
  type        = number
}

${ROLE_VARIABLE}
${TAGS_VARIABLE}`

const EXISTING_VARIABLES = `variable "identifier" {
  description = "Existing RDS instance identifier."
  type        = string
}

${ROLE_VARIABLE}
${TAGS_VARIABLE}`

const CREATE = `resource "aws_db_subnet_group" "this" {
  name       = var.identifier
  subnet_ids = var.subnet_ids
  tags       = var.tags
}

resource "aws_security_group" "this" {
  name        = "\${var.identifier}-postgres"
  description = "PostgreSQL access for \${var.identifier}"
  vpc_id      = var.vpc_id
  tags        = var.tags
}

resource "aws_vpc_security_group_ingress_rule" "postgres" {
  for_each          = toset(var.allowed_cidrs)
  security_group_id = aws_security_group.this.id
  cidr_ipv4         = each.value
  from_port         = 5432
  to_port           = 5432
  ip_protocol       = "tcp"
}

# RDS keeps the master password in Secrets Manager; it never enters this source or state.
resource "aws_db_instance" "this" {
  identifier                  = var.identifier
  engine                      = "postgres"
  engine_version              = var.engine_version
  instance_class              = var.instance_class
  allocated_storage           = var.allocated_storage
  storage_type                = "gp3"
  storage_encrypted           = true
  db_name                     = var.database_name
  username                    = "app_admin"
  manage_master_user_password = true
  db_subnet_group_name        = aws_db_subnet_group.this.name
  vpc_security_group_ids      = [aws_security_group.this.id]
  publicly_accessible         = false
  deletion_protection         = var.deletion_protection
  skip_final_snapshot         = var.skip_final_snapshot
  final_snapshot_identifier   = var.skip_final_snapshot ? null : "\${var.identifier}-final"
  backup_retention_period     = var.backup_retention_days
  auto_minor_version_upgrade  = true
  copy_tags_to_snapshot       = true
  tags                        = var.tags
}

locals {
  address    = aws_db_instance.this.address
  port       = aws_db_instance.this.port
  db_name    = aws_db_instance.this.db_name
  secret_arn = aws_db_instance.this.master_user_secret[0].secret_arn
}

data "aws_iam_policy_document" "access" {
  statement {
    sid       = "ReadMasterSecret"
    actions   = ["secretsmanager:GetSecretValue", "secretsmanager:DescribeSecret"]
    resources = [local.secret_arn]
  }
}

resource "aws_iam_policy" "access" {
  name        = "\${var.identifier}-db-secret-read"
  description = "Read the database credentials secret of \${var.identifier}"
  policy      = data.aws_iam_policy_document.access.json
  tags        = var.tags
}

resource "aws_iam_role_policy_attachment" "workload" {
  count      = var.role_name == null ? 0 : 1
  role       = var.role_name
  policy_arn = aws_iam_policy.access.arn
}
`
const EXISTING = `# Connect, never create: plan fails if the instance does not exist.
data "aws_db_instance" "this" {
  db_instance_identifier = var.identifier
}

locals {
  address    = data.aws_db_instance.this.address
  port       = data.aws_db_instance.this.port
  db_name    = data.aws_db_instance.this.db_name
  secret_arn = try(data.aws_db_instance.this.master_user_secret[0].secret_arn, null)
}

data "aws_iam_policy_document" "access" {
  count = local.secret_arn == null ? 0 : 1
  statement {
    sid       = "ReadMasterSecret"
    actions   = ["secretsmanager:GetSecretValue", "secretsmanager:DescribeSecret"]
    resources = [local.secret_arn]
  }
}

resource "aws_iam_policy" "access" {
  count       = local.secret_arn == null ? 0 : 1
  name        = "\${var.identifier}-db-secret-read"
  description = "Read the database credentials secret of \${var.identifier}"
  policy      = data.aws_iam_policy_document.access[0].json
  tags        = var.tags
}

resource "aws_iam_role_policy_attachment" "workload" {
  count      = var.role_name == null || local.secret_arn == null ? 0 : 1
  role       = var.role_name
  policy_arn = aws_iam_policy.access[0].arn
}
`
const OUTPUTS = `output "address" {
  value = local.address
}

output "port" {
  value = tostring(local.port)
}

output "database_name" {
  value = local.db_name
}

output "master_secret_arn" {
  value = local.secret_arn
}
`

function list(values: string[]): string {
  return `[${values.map((value) => JSON.stringify(value)).join(', ')}]`
}

export function renderPostgresDatabase(input: PostgresDatabase): RecipeFile[] {
  const create = input.mode === 'create'
  const entries: [string, string][] = create
    ? [
        ['identifier', JSON.stringify(input.identifier)],
        ['database_name', JSON.stringify(input.databaseName)],
        ['engine_version', JSON.stringify(input.engineVersion)],
        ['instance_class', JSON.stringify(input.instanceClass)],
        ['allocated_storage', String(input.allocatedStorage)],
        ['vpc_id', hclString(input.vpcId)],
        ['subnet_ids', list(input.subnetIds)],
        ['allowed_cidrs', list(input.allowedCidrs)],
        ['deletion_protection', String(input.deletionProtection)],
        ['skip_final_snapshot', String(input.skipFinalSnapshot)],
        ['backup_retention_days', String(input.backupRetentionDays)],
        ['role_name', hclString(input.roleName)]
      ]
    : [
        ['identifier', JSON.stringify(input.identifier)],
        ['role_name', hclString(input.roleName)]
      ]
  const prefix = input.configPrefix
  const app = `# Generated by Bastion. Connection settings for PostgreSQL "${input.identifier}"; fill the
# values from \`terraform output\` in ${input.directory}. No password here: read it at
# runtime from the secret ${prefix}_SECRET_ARN refers to.
${prefix}_HOST=
${prefix}_PORT=5432
${prefix}_NAME=${create ? input.databaseName : ''}
${prefix}_SECRET_ARN=
`
  return recipeFiles(
    input.directory,
    {
      '.gitignore': GITIGNORE,
      'main.tf': create ? CREATE : EXISTING,
      'outputs.tf': OUTPUTS,
      'provider.tf': PROVIDER_TF,
      'terraform.tfvars': tfvarsWithTags(entries, input.tags),
      'variables.tf': create ? CREATE_VARIABLES : EXISTING_VARIABLES,
      'versions.tf': VERSIONS_TF
    },
    [{ path: `${input.configDirectory}/${prefix}.env.example`, content: app }]
  )
}
