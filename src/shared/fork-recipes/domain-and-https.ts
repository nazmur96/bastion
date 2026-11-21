import { z } from 'zod'
import { recipeDirectorySchema, recipeTagSchema, type RecipeFile } from './object-storage-recipe'
import { GITIGNORE, TAGS_VARIABLE, VERSIONS_TF, recipeFiles, tfvarsWithTags } from './recipe-hcl'

/**
 * Fork: Step 14.6 domain and HTTPS. Connect, never create: the hosted zone must already exist.
 * Adds one DNS record for the application and an ACM certificate validated through DNS records
 * in that zone; apply waits until the certificate is issued. Existing records are never
 * overwritten.
 */
const label = '[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?'
export const dnsNameSchema = z
  .string()
  .max(253)
  .regex(
    new RegExp(`^${label}(?:\\.${label})+$`),
    'Use a lowercase DNS name such as app.example.com.'
  )
const wildcardOrName = z
  .string()
  .max(253)
  .regex(new RegExp(`^(?:\\*\\.)?${label}(?:\\.${label})+$`))
const within = (name: string, zone: string) => name === zone || name.endsWith(`.${zone}`)
export const domainHttpsSchema = z
  .object({
    zoneName: dnsNameSchema,
    recordName: dnsNameSchema,
    target: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('cname'), hostname: dnsNameSchema }).strict(),
      z
        .object({
          kind: z.literal('alias'),
          hostname: dnsNameSchema,
          // The target's own hosted zone id, for example a load balancer's.
          zoneId: z.string().regex(/^Z[A-Z0-9]{1,31}$/)
        })
        .strict()
    ]),
    alternativeNames: z.array(wildcardOrName).max(5),
    /** CloudFront only accepts certificates from us-east-1. */
    certificateScope: z.enum(['regional', 'cloudfront']),
    directory: recipeDirectorySchema,
    configVariable: z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/),
    configDirectory: recipeDirectorySchema,
    tags: z.object({ owner: recipeTagSchema, project: recipeTagSchema }).strict()
  })
  .strict()
  .refine((input) => within(input.recordName, input.zoneName), {
    message: 'The record must be inside the hosted zone.',
    path: ['recordName']
  })
  .refine((input) => input.target.kind === 'alias' || input.recordName !== input.zoneName, {
    message: 'A CNAME cannot be placed at the zone apex; use an alias.',
    path: ['target']
  })
  .refine(
    (input) =>
      input.alternativeNames.every((name) => within(name.replace(/^\*\./, ''), input.zoneName)),
    {
      message: 'Every alternative name must be inside the hosted zone.',
      path: ['alternativeNames']
    }
  )
  .refine((input) => input.configDirectory !== input.directory, {
    message: 'The application config directory must differ from the infra directory.'
  })
export type DomainHttps = z.infer<typeof domainHttpsSchema>

const PROVIDER = `provider "aws" {}

# Certificates for CloudFront must live in us-east-1; a regional certificate uses the default.
provider "aws" {
  alias  = "certificate"
  region = var.certificate_scope == "cloudfront" ? "us-east-1" : null
}
`
const VARIABLES = `variable "zone_name" {
  description = "Existing public hosted zone, for example example.com."
  type        = string
}

variable "record_name" {
  description = "The application's DNS name inside the zone."
  type        = string
}

variable "target_kind" {
  description = "cname or alias."
  type        = string
  validation {
    condition     = contains(["cname", "alias"], var.target_kind)
    error_message = "target_kind must be cname or alias."
  }
}

variable "target_hostname" {
  description = "Where the name points: a hostname, or the alias target's DNS name."
  type        = string
}

variable "target_zone_id" {
  description = "The alias target's hosted zone id; null for a CNAME."
  type        = string
  default     = null
}

variable "alternative_names" {
  description = "Extra names on the certificate, inside the zone."
  type        = list(string)
  default     = []
}

variable "certificate_scope" {
  description = "regional (load balancers, API Gateway) or cloudfront (us-east-1)."
  type        = string
  default     = "regional"
}

${TAGS_VARIABLE}`
const MAIN = `# Connect, never create: plan fails if the zone does not exist.
data "aws_route53_zone" "this" {
  name         = var.zone_name
  private_zone = false
}

resource "aws_route53_record" "cname" {
  count   = var.target_kind == "cname" ? 1 : 0
  zone_id = data.aws_route53_zone.this.zone_id
  name    = var.record_name
  type    = "CNAME"
  ttl     = 300
  records = [var.target_hostname]
}

resource "aws_route53_record" "alias" {
  count   = var.target_kind == "alias" ? 1 : 0
  zone_id = data.aws_route53_zone.this.zone_id
  name    = var.record_name
  type    = "A"
  alias {
    name                   = var.target_hostname
    zone_id                = var.target_zone_id
    evaluate_target_health = true
  }
}

resource "aws_acm_certificate" "this" {
  provider                  = aws.certificate
  domain_name               = var.record_name
  subject_alternative_names = var.alternative_names
  validation_method         = "DNS"
  tags                      = var.tags

  lifecycle {
    create_before_destroy = true
  }
}

locals {
  certificate_names = concat([var.record_name], var.alternative_names)
  # A wildcard shares its validation record with its base name: validate each record once,
  # keyed by names known at plan time, so no existing record is ever overwritten.
  validation_names = toset([
    for name in local.certificate_names : name
    if !(startswith(name, "*.") && contains(local.certificate_names, trimprefix(name, "*.")))
  ])
}

resource "aws_route53_record" "validation" {
  for_each = local.validation_names
  zone_id  = data.aws_route53_zone.this.zone_id
  name = one([
    for option in aws_acm_certificate.this.domain_validation_options :
    option.resource_record_name if option.domain_name == each.key
  ])
  type = one([
    for option in aws_acm_certificate.this.domain_validation_options :
    option.resource_record_type if option.domain_name == each.key
  ])
  ttl = 300
  records = [one([
    for option in aws_acm_certificate.this.domain_validation_options :
    option.resource_record_value if option.domain_name == each.key
  ])]
}

# Apply waits here until ACM has seen the records and issued the certificate.
resource "aws_acm_certificate_validation" "this" {
  provider                = aws.certificate
  certificate_arn         = aws_acm_certificate.this.arn
  validation_record_fqdns = [for record in aws_route53_record.validation : record.fqdn]

  timeouts {
    create = "30m"
  }
}
`
const OUTPUTS = `output "certificate_arn" {
  value = aws_acm_certificate_validation.this.certificate_arn
}

output "record_fqdn" {
  value = var.record_name
}

output "zone_id" {
  value = data.aws_route53_zone.this.zone_id
}
`

export function renderDomainHttps(input: DomainHttps): RecipeFile[] {
  const alias = input.target.kind === 'alias' ? input.target.zoneId : null
  const tfvars = tfvarsWithTags(
    [
      ['zone_name', JSON.stringify(input.zoneName)],
      ['record_name', JSON.stringify(input.recordName)],
      ['target_kind', JSON.stringify(input.target.kind)],
      ['target_hostname', JSON.stringify(input.target.hostname)],
      ['target_zone_id', alias === null ? 'null' : JSON.stringify(alias)],
      ['alternative_names', JSON.stringify(input.alternativeNames)],
      ['certificate_scope', JSON.stringify(input.certificateScope)]
    ],
    input.tags
  )
  return recipeFiles(
    input.directory,
    {
      '.gitignore': GITIGNORE,
      'main.tf': MAIN,
      'outputs.tf': OUTPUTS,
      'provider.tf': PROVIDER,
      'terraform.tfvars': tfvars,
      'variables.tf': VARIABLES,
      'versions.tf': VERSIONS_TF
    },
    [
      {
        path: `${input.configDirectory}/${input.configVariable}.env.example`,
        content: `# Generated by Bastion. The application's public address; its DNS record and the
# ACM certificate (${input.certificateScope}) are in ${input.directory}. Copy into your runtime configuration.
${input.configVariable}=https://${input.recordName}
`
      }
    ]
  )
}
