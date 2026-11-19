import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  objectStorageInputSchema,
  renderObjectStorageRecipe
} from '../../../shared/fork-recipes/object-storage-recipe'
import { recipeFingerprint } from './recipe-fingerprint'
import { writeRecipeFiles } from './recipe-files'
import { RealRecipeDesk } from './recipe-real'
import type { RunTerraform } from './recipe-runner'

const roots: string[] = []
afterEach(() => {
  for (const path of roots.splice(0)) {
    rmSync(path, { recursive: true, force: true })
  }
})
function temporary(): string {
  const path = mkdtempSync(join(tmpdir(), 'recipe-real-'))
  roots.push(path)
  return path
}
const files = renderObjectStorageRecipe(
  objectStorageInputSchema.parse({
    name: 'orders-assets',
    directory: 'infra/orders-assets',
    versioning: true,
    tags: { owner: 'team', project: 'checkout' }
  })
)
const identity = {
  observationId: 'o',
  accountId: '111122223333',
  arn: 'arn:aws:sts::111122223333:assumed-role/Admin/session',
  userId: 'AROA:session',
  roleArn: null,
  profileName: 'federated',
  region: 'eu-central-1',
  checkedAt: 0,
  expiresAt: null,
  anchored: true,
  toolVersion: '2.0.0'
}

const PLAN = JSON.stringify({
  resource_changes: [
    { address: 'aws_s3_bucket.this', change: { actions: ['create'] } },
    { address: 'aws_s3_bucket_versioning.this', change: { actions: ['create'] } },
    { address: 'aws_s3_bucket_policy.old', change: { actions: ['delete', 'create'] } },
    { address: 'data.aws_caller_identity.current', change: { actions: ['read'] } }
  ]
})
async function setup(
  options: {
    stamp?: () => string
    arn?: () => string
    plan?: { code: number; stdout?: string; stderr?: string }
    show?: string
  } = {}
) {
  const root = temporary()
  const dataRoot = temporary()
  await writeRecipeFiles(root, files, 'infra/orders-assets')
  const calls: { args: readonly string[]; cwd: string; env: Record<string, string | undefined> }[] =
    []
  const run: RunTerraform = async (call) => {
    calls.push({ args: call.args ?? [], cwd: call.cwd ?? '', env: { ...call.env } })
    const verb = call.args?.[0]
    if (verb === 'plan' && options.plan) {
      return {
        signal: null,
        timedOut: false,
        outputTruncated: false,
        stdout: '',
        stderr: '',
        ...options.plan
      }
    }
    if (verb === 'plan') {
      const out = (call.args ?? []).find((arg) => arg.startsWith('-out='))?.slice(5)
      if (out) {
        writeFileSync(out, 'plan')
      }
    }
    return {
      code: 0,
      signal: null,
      stdout:
        verb === 'output'
          ? '{"bucket_name":{"value":"orders-assets"}}'
          : verb === 'show'
            ? (options.show ?? PLAN)
            : '',
      stderr: '',
      timedOut: false,
      outputTruncated: false
    }
  }
  const desk = new RealRecipeDesk(
    dataRoot,
    async () => ({
      identity: { ...identity, arn: options.arn?.() ?? identity.arn },
      root,
      stamp: options.stamp?.() ?? 'stamp-1',
      current: () => {}
    }),
    async () => ({ executable: '/mise/terraform', version: '1.17.2' }),
    { PATH: '/owner/bin', HOME: '/owner/home' },
    run
  )
  const request = {
    projectId: 'p',
    targetId: '10000000-0000-4000-8000-000000000001',
    directory: 'infra/orders-assets',
    fingerprint: recipeFingerprint(files),
    operation: 'apply' as const
  }
  return { root, dataRoot, calls, desk, request }
}

describe('real AWS recipe changes', () => {
  it('shows the verified account and files, then runs once in the project directory', async () => {
    const { root, dataRoot, calls, desk, request } = await setup()
    const challenge = await desk.prepare(request)
    expect(challenge).toMatchObject({
      accountId: '111122223333',
      profileName: 'federated',
      region: 'eu-central-1',
      terraform: '1.17.2',
      operation: 'apply',
      plan: {
        add: 2,
        change: 0,
        replace: 1,
        destroy: 0,
        resources: [
          { address: 'aws_s3_bucket.this', action: 'create' },
          { address: 'aws_s3_bucket_versioning.this', action: 'create' },
          { address: 'aws_s3_bucket_policy.old', action: 'replace' }
        ]
      }
    })
    // Preparing only plans: no apply has run yet.
    expect(calls.map((call) => call.args[0])).toEqual(['init', 'plan', 'show'])
    const planFile = calls[1].args.find((arg) => arg.startsWith('-out='))?.slice(5) ?? ''
    expect(planFile.startsWith(join(dataRoot, 'bastion-recipes', 'real-plans'))).toBe(true)
    const result = await desk.deliver(challenge.grantId)
    expect(result.outputs).toEqual({ bucket_name: 'orders-assets' })
    // Exactly the saved plan is applied, then the plan file is removed.
    expect(calls.slice(3).map((call) => call.args)).toEqual([
      ['apply', '-input=false', '-no-color', planFile],
      ['output', '-json', '-no-color']
    ])
    expect(existsSync(planFile)).toBe(false)
    // State lives with the source, not in Bastion's private data.
    expect(calls.every((call) => call.cwd === join(root, 'infra/orders-assets'))).toBe(true)
    expect(calls[1].env).toMatchObject({ AWS_PROFILE: 'federated', TF_IN_AUTOMATION: '1' })
    const receipts = readFileSync(join(dataRoot, 'bastion-recipes', 'real-receipts.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
    expect(receipts.map((receipt) => receipt.status)).toEqual(['started', 'passed'])
    expect(receipts[0]).toMatchObject({
      accountId: '111122223333',
      operation: 'apply',
      plan: { add: 2, replace: 1 }
    })
    // One use: the same confirmation cannot run again.
    await expect(desk.deliver(challenge.grantId)).rejects.toMatchObject({ code: 'grant' })
  })
  it('refuses when the reviewed files changed, before or after the confirmation', async () => {
    const { root, calls, desk, request } = await setup()
    await expect(
      desk.prepare({ ...request, fingerprint: `sha256:${'0'.repeat(64)}` })
    ).rejects.toMatchObject({ code: 'changed' })
    const challenge = await desk.prepare(request)
    writeFileSync(join(root, 'infra/orders-assets/main.tf'), '# edited after review\n')
    await expect(desk.deliver(challenge.grantId)).rejects.toMatchObject({ code: 'changed' })
    expect(calls.some((call) => call.args[0] === 'apply')).toBe(false)
  })
  it('refuses a confirmation whose account or selection changed since it was shown', async () => {
    let arn = identity.arn
    let stamp = 'stamp-1'
    const { calls, desk, request } = await setup({ arn: () => arn, stamp: () => stamp })
    const first = await desk.prepare(request)
    arn = 'arn:aws:sts::111122223333:assumed-role/Other/session'
    await expect(desk.deliver(first.grantId)).rejects.toMatchObject({ code: 'grant' })
    arn = identity.arn
    const second = await desk.prepare(request)
    stamp = 'stamp-2'
    await expect(desk.deliver(second.grantId)).rejects.toMatchObject({ code: 'grant' })
    expect(calls.some((call) => call.args[0] === 'apply')).toBe(false)
  })
  it('never runs a cancelled or unknown confirmation', async () => {
    const { calls, desk, request } = await setup()
    const challenge = await desk.prepare(request)
    desk.cancel(challenge.grantId)
    await expect(desk.deliver(challenge.grantId)).rejects.toMatchObject({ code: 'grant' })
    await expect(desk.deliver('10000000-0000-4000-8000-00000000000f')).rejects.toMatchObject({
      code: 'grant'
    })
    expect(calls.some((call) => call.args[0] === 'apply')).toBe(false)
  })
  it('refuses a plan Terraform could not make, with its own reason, and keeps no plan file', async () => {
    const { dataRoot, desk, request } = await setup({
      plan: { code: 1, stderr: 'Error: No valid credential sources found' }
    })
    await expect(desk.prepare(request)).rejects.toMatchObject({
      code: 'plan',
      detail: 'Error: No valid credential sources found'
    })
    expect(readdirSync(join(dataRoot, 'bastion-recipes', 'real-plans'))).toEqual([])
  })
  it('reports a plan with nothing to change as zero changes', async () => {
    const { desk, request } = await setup({ show: JSON.stringify({ resource_changes: [] }) })
    const challenge = await desk.prepare({ ...request, operation: 'destroy' })
    expect(challenge.plan).toMatchObject({ add: 0, change: 0, replace: 0, destroy: 0 })
  })
})
