import { z } from 'zod'

/**
 * Fork: the object storage recipe (Step 10.1). Inputs are validated so nothing the engineer
 * types can become HCL syntax; output is ordinary Terraform the engineer owns afterwards.
 */
export const AWS_PROVIDER_CONSTRAINT = '~> 6.73'
export type RecipeFile = { path: string; content: string }

export const bucketNameSchema = z
  .string()
  .regex(
    /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/,
    'Use 3–63 lowercase letters, digits, dots or hyphens.'
  )
  .refine((value) => !value.includes('..'), 'Bucket names cannot contain "..".')
  .refine((value) => !/^\d+\.\d+\.\d+\.\d+$/.test(value), 'Bucket names cannot look like an IP.')
export const recipeDirectorySchema = z
  .string()
  .max(128)
  .regex(/^[A-Za-z0-9_-][A-Za-z0-9._-]*(?:\/[A-Za-z0-9_-][A-Za-z0-9._-]*){0,3}$/)
  .refine((value) => value.split('/').every((part) => part !== '..' && part !== '.'))
// No quotes, backslashes, `$` or `%`: tag text can never open an HCL template or directive.
export const recipeTagSchema = z
  .string()
  .max(128)
  .regex(/^[A-Za-z0-9 _.:/=+@-]*$/)
export const objectStorageInputSchema = z
  .object({
    name: bucketNameSchema,
    directory: recipeDirectorySchema,
    versioning: z.boolean(),
    tags: z.object({ owner: recipeTagSchema, project: recipeTagSchema }).strict()
  })
  .strict()
export type ObjectStorageInput = z.infer<typeof objectStorageInputSchema>

function aligned(entries: [string, string][], indent = ''): string {
  const width = Math.max(...entries.map(([key]) => key.length))
  return entries.map(([key, value]) => `${indent}${key.padEnd(width)} = ${value}`).join('\n')
}

const VERSIONS = `terraform {
  required_version = ">= 1.6"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "${AWS_PROVIDER_CONSTRAINT}"
    }
  }
}
`
const VARIABLES = `variable "name" {
  description = "Bucket name. Must be globally unique on real AWS."
  type        = string
}

variable "versioning" {
  description = "Keep previous object versions."
  type        = bool
  default     = true
}

variable "tags" {
  description = "Ownership tags applied to every resource."
  type        = map(string)
  default     = {}
}
`
const MAIN = `resource "aws_s3_bucket" "this" {
  bucket = var.name
  tags   = var.tags
}

resource "aws_s3_bucket_public_access_block" "this" {
  bucket                  = aws_s3_bucket.this.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "this" {
  bucket = aws_s3_bucket.this.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "this" {
  bucket = aws_s3_bucket.this.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_versioning" "this" {
  bucket = aws_s3_bucket.this.id
  versioning_configuration {
    status = var.versioning ? "Enabled" : "Suspended"
  }
}
`
const OUTPUTS = `output "bucket_name" {
  value = aws_s3_bucket.this.id
}

output "bucket_arn" {
  value = aws_s3_bucket.this.arn
}
`
const GITIGNORE = `.terraform/
*.tfstate
*.tfstate.*
crash.log
`

export function renderObjectStorageRecipe(input: ObjectStorageInput): RecipeFile[] {
  const tags = aligned(
    [
      ['"managed-by"', '"bastion-recipe"'],
      ['owner', JSON.stringify(input.tags.owner)],
      ['project', JSON.stringify(input.tags.project)]
    ],
    '  '
  )
  const tfvars = `${aligned([
    ['name', JSON.stringify(input.name)],
    ['versioning', String(input.versioning)]
  ])}
tags = {
${tags}
}
`
  const files: Record<string, string> = {
    '.gitignore': GITIGNORE,
    'main.tf': MAIN,
    'outputs.tf': OUTPUTS,
    'provider.tf': 'provider "aws" {}\n',
    'terraform.tfvars': tfvars,
    'variables.tf': VARIABLES,
    'versions.tf': VERSIONS
  }
  return Object.keys(files)
    .sort()
    .map((name) => ({ path: `${input.directory}/${name}`, content: files[name] }))
}
