import { z } from 'zod'
import { recipeDirectorySchema, recipeTagSchema, type RecipeFile } from './object-storage-recipe'
import {
  GITIGNORE,
  PROVIDER_TF,
  TAGS_VARIABLE,
  VERSIONS_TF,
  recipeFiles,
  tfvarsWithTags
} from './recipe-hcl'

/** Fork: an ECR repository (Step 10.5). Immutable tags, scan on push, encrypted, pruned. */
export const containerRegistrySchema = z
  .object({
    name: z
      .string()
      .max(200)
      .regex(/^[a-z0-9]+(?:[._-][a-z0-9]+)*(?:\/[a-z0-9]+(?:[._-][a-z0-9]+)*)*$/),
    keepImages: z.number().int().min(1).max(1000),
    scanOnPush: z.boolean(),
    directory: recipeDirectorySchema,
    tags: z.object({ owner: recipeTagSchema, project: recipeTagSchema }).strict()
  })
  .strict()
export type ContainerRegistry = z.infer<typeof containerRegistrySchema>

/** Fork: a workload role (Step 10.5) trusted by one AWS service in this account only. */
export const workloadRoleSchema = z
  .object({
    name: z.string().regex(/^[\w+=,.@-]{1,64}$/),
    service: z.enum(['ecs-tasks.amazonaws.com', 'lambda.amazonaws.com']),
    directory: recipeDirectorySchema,
    tags: z.object({ owner: recipeTagSchema, project: recipeTagSchema }).strict()
  })
  .strict()
export type WorkloadRole = z.infer<typeof workloadRoleSchema>

const REGISTRY_VARIABLES = `variable "name" {
  description = "Repository name."
  type        = string
}

variable "keep_images" {
  description = "How many most recent images to keep."
  type        = number
}

variable "scan_on_push" {
  description = "Scan each pushed image for vulnerabilities."
  type        = bool
}

${TAGS_VARIABLE}`
const REGISTRY_MAIN = `resource "aws_ecr_repository" "this" {
  name                 = var.name
  image_tag_mutability = "IMMUTABLE"
  force_delete         = false
  tags                 = var.tags

  image_scanning_configuration {
    scan_on_push = var.scan_on_push
  }

  encryption_configuration {
    encryption_type = "AES256"
  }
}

resource "aws_ecr_lifecycle_policy" "this" {
  repository = aws_ecr_repository.this.name
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Keep the most recent images"
      selection = {
        tagStatus   = "any"
        countType   = "imageCountMoreThan"
        countNumber = var.keep_images
      }
      action = { type = "expire" }
    }]
  })
}
`
const REGISTRY_OUTPUTS = `output "repository_url" {
  value = aws_ecr_repository.this.repository_url
}

output "repository_arn" {
  value = aws_ecr_repository.this.arn
}
`

const ROLE_VARIABLES = `variable "name" {
  description = "Role name."
  type        = string
}

variable "service" {
  description = "The AWS service that may assume this role."
  type        = string
}

${TAGS_VARIABLE}`
const ROLE_MAIN = `data "aws_caller_identity" "current" {}

# Only the named service, and only on behalf of this account, may assume the role.
data "aws_iam_policy_document" "trust" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = [var.service]
    }
    condition {
      test     = "StringEquals"
      variable = "aws:SourceAccount"
      values   = [data.aws_caller_identity.current.account_id]
    }
  }
}

resource "aws_iam_role" "this" {
  name               = var.name
  description        = "Workload role; attach scoped policies from other recipes."
  assume_role_policy = data.aws_iam_policy_document.trust.json
  tags               = var.tags
}
`
const ROLE_OUTPUTS = `output "role_name" {
  value = aws_iam_role.this.name
}

output "role_arn" {
  value = aws_iam_role.this.arn
}
`

export function renderContainerRegistry(input: ContainerRegistry): RecipeFile[] {
  return recipeFiles(input.directory, {
    '.gitignore': GITIGNORE,
    'main.tf': REGISTRY_MAIN,
    'outputs.tf': REGISTRY_OUTPUTS,
    'provider.tf': PROVIDER_TF,
    'terraform.tfvars': tfvarsWithTags(
      [
        ['name', JSON.stringify(input.name)],
        ['keep_images', String(input.keepImages)],
        ['scan_on_push', String(input.scanOnPush)]
      ],
      input.tags
    ),
    'variables.tf': REGISTRY_VARIABLES,
    'versions.tf': VERSIONS_TF
  })
}

export function renderWorkloadRole(input: WorkloadRole): RecipeFile[] {
  return recipeFiles(input.directory, {
    '.gitignore': GITIGNORE,
    'main.tf': ROLE_MAIN,
    'outputs.tf': ROLE_OUTPUTS,
    'provider.tf': PROVIDER_TF,
    'terraform.tfvars': tfvarsWithTags(
      [
        ['name', JSON.stringify(input.name)],
        ['service', JSON.stringify(input.service)]
      ],
      input.tags
    ),
    'variables.tf': ROLE_VARIABLES,
    'versions.tf': VERSIONS_TF
  })
}
