import { describe, expect, it } from 'vitest'
import { renderSecretRotation, secretRotationSchema } from './secret-rotation'

const base = {
  secretName: 'checkout/db-password',
  mode: 'function' as const,
  functionName: 'checkout-rotation',
  everyDays: 30,
  rotateImmediately: false,
  directory: 'infra/checkout-rotation',
  tags: { owner: 'team-a', project: 'shop' }
}
const file = (files: { path: string; content: string }[], name: string) =>
  files.find((item) => item.path.endsWith(name))?.content ?? ''

describe('secret rotation recipe', () => {
  it('schedules rotation by an existing function, invokable for this secret only', () => {
    const files = renderSecretRotation(secretRotationSchema.parse(base))
    const main = file(files, 'main.tf')
    expect(main).toContain('data "aws_secretsmanager_secret" "this"')
    expect(main).toContain('data "aws_lambda_function" "rotation"')
    expect(main).not.toMatch(/resource "aws_(secretsmanager_secret|lambda_function)" /)
    expect(main).toContain('source_arn    = data.aws_secretsmanager_secret.this.arn')
    expect(main).toContain('automatically_after_days = var.every_days')
    expect(files.at(-1)?.path).toBe('runbooks/rotate-checkout-db-password.md')
  })
  it('writes a manual runbook that never prints or stores a value', () => {
    const files = renderSecretRotation(
      secretRotationSchema.parse({ ...base, mode: 'manual', functionName: null })
    )
    expect(file(files, 'main.tf')).not.toContain('aws_secretsmanager_secret_rotation')
    const book = file(files, '.md')
    expect(book).toContain("--output text | tr -d '\\n'")
    expect(book).toContain('--secret-string file:///dev/stdin')
    // Only version ids and stages are read; never the value.
    expect(book).not.toMatch(/get-secret-value|SecretString[^"]/)
    expect(book).toContain('update-secret-version-stage')
  })
  it('needs a function exactly for managed rotation, and refuses injection', () => {
    expect(secretRotationSchema.safeParse({ ...base, functionName: null }).success).toBe(false)
    expect(secretRotationSchema.safeParse({ ...base, mode: 'manual' }).success).toBe(false)
    expect(secretRotationSchema.safeParse({ ...base, functionName: 'a"b' }).success).toBe(false)
    expect(secretRotationSchema.safeParse({ ...base, secretName: 'x y' }).success).toBe(false)
    expect(secretRotationSchema.safeParse({ ...base, everyDays: 0 }).success).toBe(false)
  })
})

describe('secret rotation on Floci', () => {
  it('is validate-only when it schedules a function, deliverable when manual', async () => {
    const { flociUnsupportedResource } = await import('../../main/fork/recipes/recipe-runner')
    expect(flociUnsupportedResource(renderSecretRotation(secretRotationSchema.parse(base)))).toBe(
      'aws_secretsmanager_secret_rotation'
    )
    expect(
      flociUnsupportedResource(
        renderSecretRotation(
          secretRotationSchema.parse({ ...base, mode: 'manual', functionName: null })
        )
      )
    ).toBeNull()
  })
})
