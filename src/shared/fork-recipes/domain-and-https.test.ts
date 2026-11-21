import { describe, expect, it } from 'vitest'
import { domainHttpsSchema, renderDomainHttps } from './domain-and-https'

const input = {
  zoneName: 'example.com',
  recordName: 'app.example.com',
  target: { kind: 'cname' as const, hostname: 'lb-1.eu-central-1.elb.amazonaws.com' },
  alternativeNames: ['*.app.example.com'],
  certificateScope: 'regional' as const,
  directory: 'infra/app-https',
  configVariable: 'APP_PUBLIC_URL',
  configDirectory: 'config',
  tags: { owner: 'team-a', project: 'shop' }
}
const file = (files: { path: string; content: string }[], name: string) =>
  files.find((item) => item.path.endsWith(name))?.content ?? ''

describe('domain and HTTPS recipe', () => {
  it('connects to the zone, adds one record and a DNS-validated certificate that apply waits for', () => {
    const files = renderDomainHttps(domainHttpsSchema.parse(input))
    const main = file(files, 'main.tf')
    expect(main).toContain('data "aws_route53_zone" "this"')
    expect(main).not.toMatch(/resource "aws_route53_zone"/)
    // Existing records are never overwritten.
    expect(main).not.toContain('allow_overwrite')
    expect(main).toContain('validation_method         = "DNS"')
    expect(main).toContain('resource "aws_acm_certificate_validation" "this"')
    // Keyed by names known at plan time; a wildcard sharing its base name's record is skipped.
    expect(main).toContain('for_each = local.validation_names')
    expect(file(files, 'outputs.tf')).toContain(
      'aws_acm_certificate_validation.this.certificate_arn'
    )
    const tfvars = file(files, 'terraform.tfvars')
    expect(tfvars).toMatch(/target_zone_id\s+= null/)
    expect(tfvars).toContain('["*.app.example.com"]')
    expect(file(files, '.env.example')).toContain('APP_PUBLIC_URL=https://app.example.com')
  })
  it('issues CloudFront certificates from us-east-1 through the certificate provider', () => {
    const files = renderDomainHttps(
      domainHttpsSchema.parse({ ...input, certificateScope: 'cloudfront' })
    )
    expect(file(files, 'provider.tf')).toContain(
      'region = var.certificate_scope == "cloudfront" ? "us-east-1" : null'
    )
    expect(file(files, 'main.tf').match(/provider\s+= aws\.certificate/g)).toHaveLength(2)
  })
  it('keeps every name inside the zone and refuses a CNAME at the apex', () => {
    const bad = [
      { recordName: 'app.other.com' },
      { recordName: 'notexample.com' },
      { recordName: 'example.com' },
      { alternativeNames: ['www.other.com'] },
      {
        alternativeNames: [
          'a.example.com',
          'b.example.com',
          'c.example.com',
          'd.example.com',
          'e.example.com',
          'f.example.com'
        ]
      },
      { recordName: 'App.example.com' },
      { target: { kind: 'cname', hostname: 'x"; evil' } },
      { target: { kind: 'alias', hostname: 'lb.example.net', zoneId: 'not-a-zone' } },
      { configDirectory: 'infra/app-https' }
    ]
    for (const change of bad) {
      expect(
        domainHttpsSchema.safeParse({ ...input, ...change }).success,
        JSON.stringify(change)
      ).toBe(false)
    }
    expect(
      domainHttpsSchema.safeParse({
        ...input,
        recordName: 'example.com',
        target: { kind: 'alias', hostname: 'd111.cloudfront.net', zoneId: 'Z2FDTNDATAQYW2' }
      }).success
    ).toBe(true)
  })
})
