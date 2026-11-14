import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CloudTargetCatalog } from './cloud-target-catalog'
import { RealAwsController, type RealAwsContext } from './real-aws-controller'
import { RealAwsFailure } from '../../../shared/fork-cloud/real-aws-contract'
import type { callRealAwsOperation } from './real-aws-operations'
let root: string, catalog: CloudTargetCatalog, targetId: string, controller: RealAwsController
const identity = {
  Account: '000000000000',
  Arn: 'arn:aws:iam::000000000000:user/fixture',
  UserId: 'AIDA00000000000000000'
}
const responses: Record<string, unknown> = {
  identity,
  tagging: { ResourceTagMappingList: [] },
  s3: { Buckets: [] },
  dynamodb: { TableNames: [] },
  sqs: { QueueUrls: [] },
  lambda: { Functions: [] },
  budgets: { Budgets: [] }
}
const call = vi.fn<typeof callRealAwsOperation>()
const projectId = 'folder:fixture'
function target() {
  const value = catalog.snapshot(projectId).targets.find((target) => target.id === targetId)
  if (!value || value.configuration.kind !== 'real') {
    throw new Error('Missing fixture')
  }
  return value
}
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'real-aws-owner-'))
  catalog = new CloudTargetCatalog(root)
  catalog.mutate(0, {
    kind: 'add',
    label: 'Fixture',
    configuration: {
      kind: 'real',
      provider: 'aws',
      profileName: 'fixture-federated',
      region: 'us-east-1'
    }
  })
  targetId = catalog.snapshot().targets[0].id
  catalog.select(1, projectId, targetId, { root, hostId: 'local' })
  call.mockReset()
  call.mockImplementation(async (_tool, _env, _root, operation, _parameters, _timeout, audit) => {
    audit?.push(operation)
    return structuredClone(responses[operation])
  })
  const resolve = async (): Promise<RealAwsContext> => {
    const value = target(),
      config = value.configuration
    if (config.kind !== 'real') {
      throw new Error('Wrong fixture')
    }
    const stamp = JSON.stringify([
      catalog.snapshot(projectId).selection?.generation,
      value.configRevision
    ])
    return {
      root,
      configuration: config,
      stamp,
      current() {
        if (
          stamp !==
          JSON.stringify([
            catalog.snapshot(projectId).selection?.generation,
            target().configRevision
          ])
        ) {
          throw new RealAwsFailure('owner-changed')
        }
      }
    }
  }
  controller = new RealAwsController(catalog, resolve, () => {}, {
    environment: () => ({ HOME: root }),
    tool: async () => ({
      executable: '/fixture/aws',
      version: '2.40.0',
      fingerprint: 'fixture',
      assertCurrent() {}
    }),
    call
  })
})
afterEach(() => {
  controller.close()
  catalog.close()
  rmSync(root, { recursive: true, force: true })
})
async function anchor() {
  const observed = await controller.verify(projectId, targetId)
  return controller.accept(projectId, targetId, observed.observationId, catalog.snapshot().revision)
}
describe('real AWS identity and batch fencing', () => {
  it('accepts a one-use fresh observation through existing target metadata and increments config only', async () => {
    const observed = await controller.verify(projectId, targetId),
      revision = catalog.snapshot().revision
    expect(observed).toMatchObject({ anchored: false, expiresAt: null })
    await controller.accept(projectId, targetId, observed.observationId, revision)
    expect(target()).toMatchObject({
      configRevision: 1,
      configuration: { expectedAccountId: identity.Account }
    })
    await expect(
      controller.accept(projectId, targetId, observed.observationId, catalog.snapshot().revision)
    ).rejects.toThrow('Verify')
  })
  it('requires an anchor, then verifies once at admission and once at publication, not once per page', async () => {
    await expect(controller.read(projectId, targetId, 'resources')).rejects.toThrow('accept')
    await anchor()
    call.mockClear()
    const result = await controller.read(projectId, targetId, 'resources')
    expect(result.data).toMatchObject({ results: expect.any(Array) })
    expect(call.mock.calls.map((args) => args[3])).toEqual([
      'identity',
      'tagging',
      's3',
      'dynamodb',
      'sqs',
      'lambda',
      'identity'
    ])
  })
  it('refuses a target A-B-A round trip between verify and accept with no accepted anchor', async () => {
    const observed = await controller.verify(projectId, targetId)
    catalog.select(catalog.snapshot().revision, projectId, null, { root, hostId: 'local' })
    catalog.select(catalog.snapshot().revision, projectId, targetId, { root, hostId: 'local' })
    await expect(
      controller.accept(projectId, targetId, observed.observationId, catalog.snapshot().revision)
    ).rejects.toThrow('changed')
    expect(target().configuration).not.toHaveProperty('expectedAccountId')
  })
  it('drops a batch when the publication identity differs, keeping no new anchor', async () => {
    await anchor()
    let checks = 0
    call.mockImplementation(async (_tool, _env, _root, operation) =>
      operation === 'identity' && ++checks === 2
        ? { ...identity, UserId: 'AIDA_OTHER' }
        : structuredClone(responses[operation])
    )
    await expect(controller.read(projectId, targetId, 'resources')).rejects.toThrow('identity')
  })
  it('looks up an assumed role only to propose or match a role anchor', async () => {
    const assumed = {
      Account: '000000000000',
      Arn: 'arn:aws:sts::000000000000:assumed-role/Fixture/fixture-session',
      UserId: 'AROA00000000000000000:fixture-session'
    }
    call.mockImplementation(async (_tool, _env, _root, operation) => {
      if (operation === 'role') {
        throw new RealAwsFailure('cli-failed')
      }
      return structuredClone(operation === 'identity' ? assumed : responses[operation])
    })
    // An unreadable role lookup leaves an account-only anchor instead of blocking verification.
    expect(await anchor()).toMatchObject({ roleArn: null, anchored: true })
    call.mockClear()
    await controller.read(projectId, targetId, 'resources')
    expect(call.mock.calls.map((args) => args[3])).not.toContain('role')
  })
  it('preserves independent denied results but aborts on classified service expiry', async () => {
    await anchor()
    call.mockImplementation(async (_tool, _env, _root, operation) => {
      if (operation === 'lambda') {
        throw new RealAwsFailure('denied')
      }
      return structuredClone(responses[operation])
    })
    expect((await controller.read(projectId, targetId, 'resources')).data).toMatchObject({
      results: expect.arrayContaining([
        expect.objectContaining({ service: 'lambda', status: 'denied' })
      ])
    })
    call.mockImplementation(async (_tool, _env, _root, operation) => {
      if (operation === 's3') {
        throw new RealAwsFailure('service-token-expired')
      }
      return structuredClone(responses[operation])
    })
    await expect(controller.read(projectId, targetId, 'resources')).rejects.toThrow('expired token')
  })
})
