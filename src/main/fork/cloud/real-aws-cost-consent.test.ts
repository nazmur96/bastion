import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { CloudTargetCatalog } from './cloud-target-catalog'
import { ChangeLedger } from '../changes/change-ledger'
import { RealAwsController, type RealAwsContext } from './real-aws-controller'
import { RealAwsFailure } from '../../../shared/fork-cloud/real-aws-contract'
import Database from '../../sqlite/sync-database'
import type { callRealAwsOperation } from './real-aws-operations'

const forbiddenProcess = vi.hoisted(() => ({
  runProcess: vi.fn(() => {
    throw new Error('Only injected operation fake is allowed')
  }),
  spawn: vi.fn(() => {
    throw new Error('Unexpected spawn')
  }),
  execFile: vi.fn(() => {
    throw new Error('Unexpected execFile')
  })
}))
vi.mock('@orca/process-host', () => ({ runProcess: forbiddenProcess.runProcess }))
vi.mock('node:child_process', () => ({
  spawn: forbiddenProcess.spawn,
  execFile: forbiddenProcess.execFile
}))

const projectId = 'folder:billing-fixture'
const identity = {
  Account: '000000000000',
  Arn: 'arn:aws:iam::000000000000:user/fixture',
  UserId: 'AIDA_FIXTURE'
}
const page = {
  ResultsByTime: [
    {
      TimePeriod: { Start: '2026-11-01', End: '2026-11-14' },
      Total: { UnblendedCost: { Amount: '1.25', Unit: 'USD' } },
      Estimated: true
    }
  ],
  PrivatePayload: 'DO_NOT_PROJECT',
  NextPageToken: 'PRIVATE_PAGE_TOKEN'
}
let root: string, catalog: CloudTargetCatalog, ledger: ChangeLedger, targetId: string
let controller: RealAwsController, charges: number, owner: string, fingerprint: string
let calls: string[]
const call = vi.fn<typeof callRealAwsOperation>()
const controllers: RealAwsController[] = []
async function invoke(
  instance: RealAwsController,
  name: string,
  ...args: unknown[]
): Promise<unknown> {
  const method: unknown = Reflect.get(instance, name)
  if (typeof method !== 'function') {
    throw new Error(`Missing 9.3b controller behavior: ${name}`)
  }
  return Reflect.apply(method, instance, args)
}
function create(windowId = 'window-a', ownerRunId = 'main-instance-a') {
  const dependencies = {
    environment: () => ({ HOME: root }),
    tool: async () => ({
      executable: '/fixture/aws',
      version: '2.40.0',
      fingerprint,
      assertCurrent() {}
    }),
    call,
    ledger,
    ownerRunId,
    windowId
  }
  const instance = new RealAwsController(
    catalog,
    async (requestedProject, requestedTarget): Promise<RealAwsContext> => {
      if (requestedProject !== projectId || requestedTarget !== targetId) {
        throw new RealAwsFailure('owner-changed')
      }
      const target = catalog.snapshot(projectId).targets.find((t) => t.id === targetId)
      if (!target || target.configuration.kind !== 'real') {
        throw new Error('Missing fixture')
      }
      const stamp = JSON.stringify([
        owner,
        target.configRevision,
        catalog.snapshot(projectId).selection?.generation
      ])
      return {
        root,
        configuration: target.configuration,
        stamp,
        current() {
          const current = catalog.snapshot(projectId)
          if (
            stamp !==
            JSON.stringify([
              owner,
              current.targets.find((t) => t.id === targetId)?.configRevision,
              current.selection?.generation
            ])
          ) {
            throw new RealAwsFailure('owner-changed')
          }
        }
      }
    },
    () => {},
    dependencies
  )
  controllers.push(instance)
  return instance
}
async function grant(requestId = randomUUID()) {
  const challenge = z
    .object({ challengeId: z.string(), accountId: z.string(), query: z.unknown() })
    .parse(await invoke(controller, 'prepareCost', projectId, targetId, requestId))
  const value = z
    .object({ grantId: z.string(), expiresAt: z.number() })
    .parse(await invoke(controller, 'confirmCost', projectId, targetId, challenge.challengeId))
  return { ...value, requestId, challenge }
}
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-14T12:00:00Z'))
  root = mkdtempSync(join(tmpdir(), 'cost-consent-'))
  catalog = new CloudTargetCatalog(root)
  ledger = new ChangeLedger(root)
  catalog.mutate(0, {
    kind: 'add',
    label: 'Billing fixture',
    configuration: {
      kind: 'real',
      provider: 'aws',
      profileName: 'fixture-profile',
      region: 'us-west-2',
      expectedAccountId: identity.Account
    }
  })
  targetId = catalog.snapshot().targets[0].id
  catalog.select(1, projectId, targetId, { root, hostId: 'local' })
  charges = 0
  owner = 'runtime-a'
  fingerprint = 'binary-a'
  calls = []
  call.mockReset()
  call.mockImplementation(async (_tool, _env, _root, operation) => {
    calls.push(operation)
    if (operation === 'cost-and-usage') {
      charges++
      return structuredClone(page)
    }
    if (operation === 'identity') {
      return structuredClone(identity)
    }
    return operation === 'budgets'
      ? { Budgets: [] }
      : { ResourceTagMappingList: [], Buckets: [], TableNames: [], QueueUrls: [], Functions: [] }
  })
  controller = create()
})
afterEach(() => {
  for (const instance of controllers.splice(0)) {
    instance.close()
  }
  ledger.close()
  catalog.close()
  rmSync(root, { recursive: true, force: true })
  expect(forbiddenProcess.runProcess).not.toHaveBeenCalled()
  expect(forbiddenProcess.spawn).not.toHaveBeenCalled()
  expect(forbiddenProcess.execFile).not.toHaveBeenCalled()
  vi.clearAllMocks()
  vi.useRealTimers()
})
describe('RA-09 one-use Cost Explorer consent with a fake charged-call counter', () => {
  it('never requests billing on cache miss, reload-equivalent controller creation, ordinary reads or clock expiry', async () => {
    expect(await invoke(controller, 'cachedCost', projectId, targetId)).toBeNull()
    await controller.read(projectId, targetId, 'resources')
    await controller.read(projectId, targetId, 'budgets')
    expect(await invoke(create(), 'cachedCost', projectId, targetId)).toBeNull()
    vi.setSystemTime(Date.now() + 3600001)
    expect(await invoke(controller, 'cachedCost', projectId, targetId)).toBeNull()
    expect(charges).toBe(0)
  })
  it('refuses missing or renderer-invented consent before any authentication or paid call', async () => {
    await expect(
      invoke(controller, 'readCost', projectId, targetId, randomUUID(), undefined)
    ).rejects.toThrow()
    await expect(
      invoke(controller, 'readCost', projectId, targetId, randomUUID(), {
        enabled: true,
        accountId: identity.Account
      })
    ).rejects.toThrow()
    expect(calls).toEqual([])
  })
  it('binds a 60-second grant to the server-built current UTC month query and projects only cost evidence', async () => {
    const g = await grant()
    expect(g.expiresAt).toBe(Date.now() + 60000)
    expect(g.challenge).toMatchObject({
      accountId: identity.Account,
      query: {
        TimePeriod: { Start: '2026-11-01', End: '2026-11-14' },
        Granularity: 'DAILY',
        Metrics: ['UnblendedCost'],
        Filter: { Dimensions: { Key: 'LINKED_ACCOUNT', Values: [identity.Account] } }
      }
    })
    calls = []
    const result = await invoke(controller, 'readCost', projectId, targetId, g.requestId, g.grantId)
    expect(result).toMatchObject({
      status: 'completed',
      observedAt: Date.now(),
      data: {
        results: [
          { start: '2026-11-01', end: '2026-11-14', amount: '1.25', unit: 'USD', estimated: true }
        ],
        moreAvailable: true
      }
    })
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE_PAGE_TOKEN|DO_NOT_PROJECT/)
    expect(charges).toBe(1)
    expect(calls.indexOf('identity')).toBe(calls.indexOf('cost-and-usage') - 1)
    expect(calls.filter((op) => op === 'cost-and-usage')).toHaveLength(1)
  })
  it.each([
    'expired',
    'selection-round-trip',
    'owner',
    'tool',
    'config',
    'utc-date',
    'account',
    'principal',
    'window',
    'request'
  ])('refuses %s context before a paid attempt', async (change) => {
    const g = await grant()
    if (change === 'expired') {
      vi.setSystemTime(Date.now() + 60000)
    }
    if (change === 'utc-date') {
      vi.setSystemTime(new Date('2026-11-15T00:00:00Z'))
    }
    if (change === 'owner') {
      owner = 'runtime-b'
    }
    if (change === 'tool') {
      fingerprint = 'binary-b'
    }
    if (change === 'selection-round-trip') {
      catalog.select(catalog.snapshot().revision, projectId, null, { root, hostId: 'local' })
      catalog.select(catalog.snapshot().revision, projectId, targetId, { root, hostId: 'local' })
    }
    if (change === 'config') {
      catalog.mutate(catalog.snapshot().revision, {
        kind: 'update-real',
        id: targetId,
        configuration: {
          kind: 'real',
          provider: 'aws',
          profileName: 'other-fixture',
          region: 'us-west-2',
          expectedAccountId: identity.Account
        }
      })
    }
    if (change === 'account' || change === 'principal') {
      call.mockImplementation(async (_t, _e, _r, operation) => {
        calls.push(operation)
        if (operation === 'cost-and-usage') {
          charges++
        }
        return {
          ...identity,
          ...(change === 'account'
            ? { Account: '111111111111', Arn: 'arn:aws:iam::111111111111:user/fixture' }
            : { UserId: 'AIDA_OTHER' })
        }
      })
    }
    const consumer = change === 'window' ? create('window-b') : controller
    calls = []
    await expect(
      invoke(
        consumer,
        'readCost',
        projectId,
        targetId,
        change === 'request' ? randomUUID() : g.requestId,
        g.grantId
      )
    ).rejects.toThrow()
    expect(charges).toBe(0)
    if (
      [
        'expired',
        'selection-round-trip',
        'owner',
        'tool',
        'config',
        'utc-date',
        'window',
        'request'
      ].includes(change)
    ) {
      expect(calls).toEqual([])
    }
  })
  it('coalesces simultaneous UUIDs and returns the existing receipt across windows without charging twice', async () => {
    const g = await grant()
    const results = await Promise.all([
      invoke(controller, 'readCost', projectId, targetId, g.requestId, g.grantId),
      invoke(controller, 'readCost', projectId, targetId, g.requestId, g.grantId)
    ])
    expect(charges).toBe(1)
    expect(results).toHaveLength(2)
    const duplicate = await invoke(
      create('window-b'),
      'readCost',
      projectId,
      targetId,
      g.requestId,
      undefined
    )
    expect(duplicate).toMatchObject({ requestId: g.requestId, status: 'completed' })
    expect(charges).toBe(1)
    await expect(
      invoke(controller, 'readCost', projectId, targetId, randomUUID(), g.grantId)
    ).rejects.toThrow()
    expect(charges).toBe(1)
  })
  it('never reuses a UUID for changed context, even with a fresh confirmation', async () => {
    const g = await grant()
    await invoke(controller, 'readCost', projectId, targetId, g.requestId, g.grantId)
    owner = 'runtime-b'
    await expect(
      invoke(controller, 'prepareCost', projectId, targetId, g.requestId)
    ).rejects.toThrow()
    expect(charges).toBe(1)
  })
  it.each(['denied', 'timeout', 'service-token-expired'])(
    'consumes the grant on %s and never retries the paid operation',
    async (code) => {
      const g = await grant()
      call.mockImplementation(async (_t, _e, _r, op) => {
        if (op === 'cost-and-usage') {
          charges++
          throw new RealAwsFailure(
            z.enum(['denied', 'timeout', 'service-token-expired']).parse(code)
          )
        }
        return structuredClone(identity)
      })
      await expect(
        invoke(controller, 'readCost', projectId, targetId, g.requestId, g.grantId)
      ).rejects.toThrow()
      expect(
        await invoke(controller, 'readCost', projectId, targetId, g.requestId, g.grantId)
      ).toMatchObject({ status: code === 'timeout' ? 'unknown' : 'failed' })
      expect(charges).toBe(1)
    }
  )
  it('expires memory cache after one hour without fetching, keeps evidence timestamps and requires new consent for refresh', async () => {
    const g = await grant()
    await invoke(controller, 'readCost', projectId, targetId, g.requestId, g.grantId)
    const cached = await invoke(controller, 'cachedCost', projectId, targetId)
    expect(cached).toMatchObject({ observedAt: Date.now(), data: { moreAvailable: true } })
    vi.setSystemTime(Date.now() + 3599999)
    expect(await invoke(controller, 'cachedCost', projectId, targetId)).toEqual(cached)
    vi.setSystemTime(Date.now() + 1)
    expect(await invoke(controller, 'cachedCost', projectId, targetId)).toBeNull()
    expect(charges).toBe(1)
    const fresh = await grant()
    await invoke(controller, 'readCost', projectId, targetId, fresh.requestId, fresh.grantId)
    expect(charges).toBe(2)
  })
  it('invalidates cached costs on owner/selection change without an automatic charge', async () => {
    const g = await grant()
    await invoke(controller, 'readCost', projectId, targetId, g.requestId, g.grantId)
    owner = 'runtime-b'
    expect(await invoke(controller, 'cachedCost', projectId, targetId)).toBeNull()
    expect(charges).toBe(1)
  })
})

describe('RA-09 receipt-first paid admission and crash boundaries', () => {
  it('never launches a paid operation when durable receipt admission fails', async () => {
    const g = await grant()
    const db = new Database(join(root, 'bastion-changes', 'changes.db'))
    try {
      db.exec(
        "CREATE TRIGGER refuse_read BEFORE INSERT ON real_aws_read_receipts BEGIN SELECT RAISE(ABORT, 'fixture storage failure'); END"
      )
    } finally {
      db.close()
    }
    await expect(
      invoke(controller, 'readCost', projectId, targetId, g.requestId, g.grantId)
    ).rejects.toThrow()
    expect(charges).toBe(0)
  })
  it('commits the receipt before the charged call and preserves unknown after lost owner/result with no replay', async () => {
    const g = await grant()
    let release: (value: unknown) => void = () => {
      throw new Error('Uninitialized fixture')
    }
    let charged: () => void = () => {
      throw new Error('Uninitialized fixture')
    }
    const response = new Promise<unknown>((resolve) => {
      release = resolve
    })
    const started = new Promise<void>((resolve) => {
      charged = resolve
    })
    const receiptMethod: unknown = Reflect.get(ledger, 'readReceipt')
    const recoverMethod: unknown = Reflect.get(ledger, 'recoverReadReceipts')
    if (typeof receiptMethod !== 'function' || typeof recoverMethod !== 'function') {
      throw new Error('Missing durable receipt behavior')
    }
    call.mockImplementation(async (_t, _e, _r, operation) => {
      if (operation !== 'cost-and-usage') {
        return structuredClone(identity)
      }
      expect(Reflect.apply(receiptMethod, ledger, [g.requestId])).toMatchObject({
        status: 'running',
        ownerRunId: 'main-instance-a'
      })
      charges++
      charged()
      return response
    })
    const pending = invoke(
      controller,
      'readCost',
      projectId,
      targetId,
      g.requestId,
      g.grantId
    ).then(
      (value) => ({ value }),
      () => ({ refused: true })
    )
    await started
    controller.close()
    Reflect.apply(recoverMethod, ledger, ['main-instance-a'])
    release(structuredClone(page))
    await pending
    expect(Reflect.apply(receiptMethod, ledger, [g.requestId])).toMatchObject({ status: 'unknown' })
    expect(
      await invoke(
        create('window-b', 'main-instance-b'),
        'readCost',
        projectId,
        targetId,
        g.requestId,
        undefined
      )
    ).toMatchObject({ status: 'unknown' })
    expect(charges).toBe(1)
  })
  it('does not publish/cache a paid result after the account changes at publication', async () => {
    const g = await grant()
    let paid = false
    call.mockImplementation(async (_t, _e, _r, operation) => {
      if (operation === 'cost-and-usage') {
        charges++
        paid = true
        return structuredClone(page)
      }
      return paid
        ? { ...identity, Account: '111111111111', Arn: 'arn:aws:iam::111111111111:user/fixture' }
        : structuredClone(identity)
    })
    await expect(
      invoke(controller, 'readCost', projectId, targetId, g.requestId, g.grantId)
    ).rejects.toThrow()
    expect(await invoke(controller, 'cachedCost', projectId, targetId)).toBeNull()
    expect(charges).toBe(1)
  })
  it('refuses confirmation after the challenge expires, and refuses an empty first-day UTC interval', async () => {
    const challenge = z
      .object({ challengeId: z.string() })
      .parse(await invoke(controller, 'prepareCost', projectId, targetId, randomUUID()))
    vi.setSystemTime(Date.now() + 60000)
    await expect(
      invoke(controller, 'confirmCost', projectId, targetId, challenge.challengeId)
    ).rejects.toThrow()
    vi.setSystemTime(new Date('2026-12-01T12:00:00Z'))
    await expect(
      invoke(controller, 'prepareCost', projectId, targetId, randomUUID())
    ).rejects.toThrow()
    expect(charges).toBe(0)
  })
})

describe('RA-10 production-controller receipt integration', () => {
  it.each(['resources', 'budgets'])(
    'records explicit %s UUID once without creating a second provider batch',
    async (operation) => {
      const requestId = randomUUID()
      await invoke(controller, 'read', projectId, targetId, operation, requestId)
      const method: unknown = Reflect.get(ledger, 'readReceipt')
      if (typeof method !== 'function') {
        throw new Error('Missing durable receipt lookup')
      }
      expect(Reflect.apply(method, ledger, [requestId])).toMatchObject({
        requestId,
        operation,
        status: 'completed',
        projectId,
        targetId
      })
      const count = calls.length
      await invoke(controller, 'read', projectId, targetId, operation, requestId)
      expect(calls).toHaveLength(count)
      await expect(
        invoke(
          controller,
          'read',
          projectId,
          targetId,
          operation === 'resources' ? 'budgets' : 'resources',
          requestId
        )
      ).rejects.toThrow()
      expect(calls).toHaveLength(count)
    }
  )
})

describe('RA-09 simultaneous window and grant fencing', () => {
  it('returns running evidence to a second window and prevents another UUID consuming the same grant', async () => {
    const g = await grant()
    let release: (value: unknown) => void = () => {
      throw new Error('Uninitialized fixture')
    }
    let admitted: () => void = () => {
      throw new Error('Uninitialized fixture')
    }
    const response = new Promise<unknown>((resolve) => {
      release = resolve
    })
    const started = new Promise<void>((resolve) => {
      admitted = resolve
    })
    call.mockImplementation(async (_t, _e, _r, operation) => {
      if (operation !== 'cost-and-usage') {
        return structuredClone(identity)
      }
      charges++
      admitted()
      return response
    })
    const pending = invoke(controller, 'readCost', projectId, targetId, g.requestId, g.grantId)
    try {
      await started
      expect(
        await invoke(create('window-b'), 'readCost', projectId, targetId, g.requestId, undefined)
      ).toMatchObject({ status: 'running' })
      await expect(
        invoke(controller, 'readCost', projectId, targetId, randomUUID(), g.grantId)
      ).rejects.toThrow()
      expect(charges).toBe(1)
    } finally {
      release(structuredClone(page))
      await pending
    }
  })
  it('refuses cross-project or target grant use before authentication', async () => {
    const g = await grant()
    calls = []
    await expect(
      invoke(controller, 'readCost', 'folder:other', targetId, g.requestId, g.grantId)
    ).rejects.toThrow()
    await expect(
      invoke(controller, 'readCost', projectId, randomUUID(), g.requestId, g.grantId)
    ).rejects.toThrow()
    expect(calls).toEqual([])
    expect(charges).toBe(0)
  })
})
