import { AWS_PROVIDER_CONSTRAINT, type RecipeFile } from './object-storage-recipe'

/** Fork: HCL pieces shared by recipes. Values reach HCL only as JSON-quoted, validated text. */
export function alignedHcl(entries: [string, string][], indent = ''): string {
  const width = Math.max(...entries.map(([key]) => key.length))
  return entries.map(([key, value]) => `${indent}${key.padEnd(width)} = ${value}`).join('\n')
}

export const VERSIONS_TF = `terraform {
  required_version = ">= 1.6"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "${AWS_PROVIDER_CONSTRAINT}"
    }
  }
}
`
export const PROVIDER_TF = 'provider "aws" {}\n'
export const GITIGNORE = `.terraform/
*.tfstate
*.tfstate.*
crash.log
`
export const TAGS_VARIABLE = `variable "tags" {
  description = "Ownership tags applied to every resource."
  type        = map(string)
  default     = {}
}
`
export const ROLE_VARIABLE = `variable "role_name" {
  description = "Existing IAM role to attach the policy to, or null."
  type        = string
  default     = null
}
`
export const ROLE_ATTACHMENT = `resource "aws_iam_role_policy_attachment" "workload" {
  count      = var.role_name == null ? 0 : 1
  role       = var.role_name
  policy_arn = aws_iam_policy.access.arn
}
`

/** A tfvars file: aligned scalar entries, then the ownership tags block. */
export function tfvarsWithTags(
  entries: [string, string][],
  tags: { owner: string; project: string }
): string {
  return `${alignedHcl(entries)}
tags = {
${alignedHcl(
  [
    ['"managed-by"', '"bastion-recipe"'],
    ['owner', JSON.stringify(tags.owner)],
    ['project', JSON.stringify(tags.project)]
  ],
  '  '
)}
}
`
}
export function hclString(value: string | null): string {
  return value === null ? 'null' : JSON.stringify(value)
}

/** Sorted infra files under one directory, then any companion files. */
export function recipeFiles(
  directory: string,
  infra: Record<string, string>,
  companions: RecipeFile[] = []
): RecipeFile[] {
  return [
    ...Object.keys(infra)
      .sort()
      .map((name) => ({ path: `${directory}/${name}`, content: infra[name] })),
    ...companions
  ]
}
