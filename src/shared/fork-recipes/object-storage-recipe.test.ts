import { describe, expect, it } from 'vitest'
import { objectStorageInputSchema, renderObjectStorageRecipe } from './object-storage-recipe'
import { recipeFingerprint } from '../../main/fork/recipes/recipe-fingerprint'

const input = {
  name: 'orders-assets',
  directory: 'infra/orders-assets',
  versioning: true,
  tags: { owner: 'platform-team', project: 'checkout' }
}

describe('object storage recipe', () => {
  it('renders the same seven ordinary source files for the same input', () => {
    const files = renderObjectStorageRecipe(objectStorageInputSchema.parse(input))
    expect(files.map((file) => file.path)).toEqual([
      'infra/orders-assets/.gitignore',
      'infra/orders-assets/main.tf',
      'infra/orders-assets/outputs.tf',
      'infra/orders-assets/provider.tf',
      'infra/orders-assets/terraform.tfvars',
      'infra/orders-assets/variables.tf',
      'infra/orders-assets/versions.tf'
    ])
    expect(renderObjectStorageRecipe(objectStorageInputSchema.parse(input))).toEqual(files)
    const text = Object.fromEntries(
      files.map((file) => [file.path.split('/').at(-1), file.content])
    )
    expect(text['versions.tf']).toContain('source  = "hashicorp/aws"')
    expect(text['versions.tf']).toContain('version = "~> 6.73"')
    expect(text['provider.tf']).toBe('provider "aws" {}\n')
    expect(text['main.tf']).toContain('block_public_policy     = true')
    expect(text['main.tf']).toContain('sse_algorithm = "AES256"')
    expect(text['main.tf']).toContain('object_ownership = "BucketOwnerEnforced"')
    expect(text['terraform.tfvars']).toContain('name       = "orders-assets"')
    expect(text['terraform.tfvars']).toContain('"managed-by" = "bastion-recipe"')
    expect(text['.gitignore']).toContain('.terraform/')
    expect(text['.gitignore']).toContain('*.tfstate')
    // No endpoint, credential or emulator setting is ever written into the project.
    expect(files.map((file) => file.content).join('\n')).not.toMatch(
      /endpoint|access_key|secret_key|skip_|127\.0\.0\.1|localhost/
    )
  })
  it.each([
    ['uppercase name', { name: 'Orders' }],
    ['too short', { name: 'ab' }],
    ['double dot', { name: 'a..b' }],
    ['ip shaped', { name: '192.168.1.1' }],
    ['absolute directory', { directory: '/etc/infra' }],
    ['parent directory', { directory: 'infra/../../x' }],
    ['hidden directory', { directory: '.git/hooks' }],
    ['template in tag', { tags: { owner: '${file("~/.aws/credentials")}', project: 'x' } }],
    ['directive in tag', { tags: { owner: '%{ if true }x%{ endif }', project: 'x' } }],
    ['quote in tag', { tags: { owner: 'a"b', project: 'x' } }]
  ])('refuses %s', (_label, change) => {
    expect(objectStorageInputSchema.safeParse({ ...input, ...change }).success).toBe(false)
  })
  it('fingerprints exact paths and content, independent of order', () => {
    const files = renderObjectStorageRecipe(objectStorageInputSchema.parse(input))
    const reversed = files.toReversed()
    expect(recipeFingerprint(reversed)).toBe(recipeFingerprint(files))
    expect(recipeFingerprint(files)).toMatch(/^sha256:[0-9a-f]{64}$/)
    const edited = files.map((file, index) =>
      index === 1 ? { ...file, content: `${file.content}# edit\n` } : file
    )
    expect(recipeFingerprint(edited)).not.toBe(recipeFingerprint(files))
  })
})
