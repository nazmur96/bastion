import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  objectStorageInputSchema,
  renderObjectStorageRecipe
} from '../../../shared/fork-recipes/object-storage-recipe'
import { recipeFingerprint } from './recipe-fingerprint'
import {
  FLOCI_OVERRIDE,
  OVERRIDE_NAME,
  deliverRecipeToFloci,
  validateRecipe,
  type RunTerraform
} from './recipe-runner'

const roots: string[] = []
afterEach(() => {
  for (const path of roots.splice(0)) {
    rmSync(path, { recursive: true, force: true })
  }
})
function context(results: Record<string, { code: number; stdout?: string; stderr?: string }>) {
  const dataRoot = mkdtempSync(join(tmpdir(), 'recipe-run-'))
  roots.push(dataRoot)
  const calls: {
    args: readonly string[]
    cwd: string
    env: Record<string, string | undefined>
    files: string[]
  }[] = []
  const run: RunTerraform = async (options) => {
    calls.push({
      args: options.args ?? [],
      cwd: options.cwd ?? '',
      env: { ...options.env },
      files: options.cwd ? readdirSync(options.cwd).sort() : []
    })
    const result = results[options.args?.[0] ?? ''] ?? { code: 0 }
    return {
      code: result.code,
      signal: null,
      stdout: result.stdout ?? '',
      stderr: result.stderr ?? '',
      timedOut: false,
      outputTruncated: false
    }
  }
  return {
    calls,
    context: {
      dataRoot,
      owner: { PATH: '/owner/bin', HOME: '/owner/home', AWS_PROFILE: 'real-profile' },
      tool: { executable: '/mise/terraform', version: '1.16.5' },
      run
    }
  }
}
const files = renderObjectStorageRecipe(
  objectStorageInputSchema.parse({
    name: 'orders-assets',
    directory: 'infra/orders-assets',
    versioning: true,
    tags: { owner: 'team', project: 'checkout' }
  })
)

describe('recipe runner', () => {
  it('validates a private copy with fmt, init without backend, then validate', async () => {
    const { context: c, calls } = context({})
    const steps = await validateRecipe(c, 'infra/orders-assets', files)
    expect(steps.map((step) => [step.step, step.ok])).toEqual([
      ['fmt', true],
      ['init', true],
      ['validate', true]
    ])
    expect(calls.map((call) => call.args[0])).toEqual(['fmt', 'init', 'validate'])
    expect(calls[1].args).toContain('-backend=false')
    for (const call of calls) {
      expect(call.cwd.startsWith(join(c.dataRoot, 'bastion-recipes'))).toBe(true)
      expect(call.files).not.toContain(OVERRIDE_NAME)
      // The owner's real AWS profile is never handed to validation.
      expect(call.env.AWS_PROFILE).toBeUndefined()
      expect(call.env.TF_PLUGIN_CACHE_DIR).toBe(join(c.dataRoot, 'bastion-recipes', 'plugin-cache'))
    }
  })
  it('stops at the first failing step with its error line', async () => {
    const { context: c } = context({
      fmt: { code: 3, stderr: 'main.tf\n' },
      init: { code: 0 }
    })
    const steps = await validateRecipe(c, 'infra/orders-assets', files)
    expect(steps).toEqual([{ step: 'fmt', ok: false, message: 'main.tf' }])
  })
  it('applies to Floci only when the reviewed fingerprint still matches', async () => {
    const { context: c, calls } = context({})
    await expect(
      deliverRecipeToFloci(c, {
        operation: 'apply',
        directory: 'infra/orders-assets',
        files: files.map((file, i) => (i === 0 ? { ...file, content: `${file.content}x` } : file)),
        reviewedFingerprint: recipeFingerprint(files),
        instanceId: 'instance-a',
        flociEnv: { AWS_ENDPOINT_URL: 'http://127.0.0.1:14566' }
      })
    ).rejects.toThrow('changed')
    expect(calls).toEqual([])
  })
  it('runs init, apply and output in a private run directory with the override and sealed env', async () => {
    const { context: c, calls } = context({
      output: {
        code: 0,
        stdout: JSON.stringify({
          bucket_name: { value: 'orders-assets', sensitive: false },
          bucket_arn: { value: 'arn:aws:s3:::orders-assets', sensitive: false },
          token: { value: 'secret-value', sensitive: true }
        })
      }
    })
    const result = await deliverRecipeToFloci(c, {
      operation: 'apply',
      directory: 'infra/orders-assets',
      files,
      reviewedFingerprint: recipeFingerprint(files),
      instanceId: 'instance-a',
      flociEnv: { AWS_ENDPOINT_URL: 'http://127.0.0.1:14566', AWS_PROFILE: 'default' }
    })
    expect(calls.map((call) => call.args.slice(0, 2))).toEqual([
      ['init', '-input=false'],
      ['apply', '-auto-approve'],
      ['output', '-json']
    ])
    const work = calls[0].cwd
    expect(work).toContain(join('bastion-recipes', 'floci', 'instance-a'))
    expect(calls[0].files).toContain(OVERRIDE_NAME)
    expect(readFileSync(join(work, OVERRIDE_NAME), 'utf8')).toBe(FLOCI_OVERRIDE)
    expect(calls[1].env.AWS_ENDPOINT_URL).toBe('http://127.0.0.1:14566')
    // The sealed Floci profile replaces the owner's real profile.
    expect(calls[1].env.AWS_PROFILE).toBe('default')
    expect(result.outputs).toEqual({
      bucket_name: 'orders-assets',
      bucket_arn: 'arn:aws:s3:::orders-assets'
    })
    expect(existsSync(join(work, '.gitignore'))).toBe(true)
  })
})
