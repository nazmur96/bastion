import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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

async function setup(options: { stamp?: () => string; arn?: () => string } = {}) {
  const root = temporary()
  const dataRoot = temporary()
  await writeRecipeFiles(root, files, 'infra/orders-assets')
  const calls: { args: readonly string[]; cwd: string; env: Record<string, string | undefined> }[] =
    []
  const run: RunTerraform = async (call) => {
    calls.push({ args: call.args ?? [], cwd: call.cwd ?? '', env: { ...call.env } })
    return {
      code: 0,
      signal: null,
      stdout: call.args?.[0] === 'output' ? '{"bucket_name":{"value":"orders-assets"}}' : '',
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
      operation: 'apply'
    })
    expect(calls).toEqual([])
    const result = await desk.deliver(challenge.grantId)
    expect(result.outputs).toEqual({ bucket_name: 'orders-assets' })
    expect(calls.map((call) => call.args[0])).toEqual(['init', 'apply', 'output'])
    // State lives with the source, not in Bastion's private data.
    expect(calls.every((call) => call.cwd === join(root, 'infra/orders-assets'))).toBe(true)
    expect(calls[1].env).toMatchObject({ AWS_PROFILE: 'federated', TF_IN_AUTOMATION: '1' })
    const receipts = readFileSync(join(dataRoot, 'bastion-recipes', 'real-receipts.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
    expect(receipts.map((receipt) => receipt.status)).toEqual(['started', 'passed'])
    expect(receipts[0]).toMatchObject({ accountId: '111122223333', operation: 'apply' })
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
    expect(calls).toEqual([])
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
    expect(calls).toEqual([])
  })
  it('never runs a cancelled or unknown confirmation', async () => {
    const { calls, desk, request } = await setup()
    const challenge = await desk.prepare(request)
    desk.cancel(challenge.grantId)
    await expect(desk.deliver(challenge.grantId)).rejects.toMatchObject({ code: 'grant' })
    await expect(desk.deliver('10000000-0000-4000-8000-00000000000f')).rejects.toMatchObject({
      code: 'grant'
    })
    expect(calls).toEqual([])
  })
})
