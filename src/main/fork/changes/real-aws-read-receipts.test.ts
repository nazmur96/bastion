import { randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ChangeLedger } from './change-ledger'
import Database from '../../sqlite/sync-database'
import { changeRecordSchema } from '../../../shared/fork-changes/change-contract'

const roots: string[] = [],
  ledgers: ChangeLedger[] = []
const hash = `sha256:${'a'.repeat(64)}`
function directory() {
  const root = mkdtempSync(join(tmpdir(), 'read-receipt-'))
  roots.push(root)
  return root
}
function open(root = directory()) {
  const ledger = new ChangeLedger(root)
  ledgers.push(ledger)
  return ledger
}
function invoke(ledger: ChangeLedger, name: string, ...args: unknown[]): unknown {
  const method: unknown = Reflect.get(ledger, name)
  if (typeof method !== 'function') {
    throw new Error(`Missing 9.3b ledger behavior: ${name}`)
  }
  return Reflect.apply(method, ledger, args)
}
function receipt() {
  return {
    requestId: randomUUID(),
    namespaceId: 'workspace-fixture',
    projectId: 'folder:fixture',
    targetId: '10000000-0000-4000-8000-000000000001',
    operation: 'cost-and-usage',
    contextFingerprint: hash,
    toolFingerprint: hash,
    identityFingerprint: hash,
    ownerRunId: 'owner-a',
    at: 1,
    status: 'running'
  }
}
function historicalRecord(emulated = false) {
  const id = randomUUID(),
    validationId = randomUUID(),
    reviewId = randomUUID()
  const snapshot = {
    adapter: 'source-check/v1',
    files: [{ path: 'main.json', fingerprint: 'a-b-c' }],
    ...(emulated
      ? {
          cloudBinding: {
            kind: 'emulated-aws',
            namespaceId: 'workspace-legacy',
            projectId: 'folder:legacy',
            targetId: '10000000-0000-4000-8000-000000000001',
            selectionGeneration: 1,
            configRevision: 0,
            policyFingerprint: hash,
            owner: {
              projectId: 'folder:legacy',
              root: '/fixture',
              hostId: 'local',
              routeKey: 'local',
              runtimeId: 'legacy-runtime',
              pairingRevision: 'legacy-pairing'
            },
            instance: {
              id: '10000000-0000-4000-8000-000000000002',
              epoch: 1,
              engineId: 'docker',
              containerId: 'legacy-container',
              imageDigest: hash,
              port: 14566,
              persistenceKey: '10000000-0000-4000-8000-000000000003'
            }
          }
        }
      : {})
  }
  const scope = { projectId: 'folder:legacy', root: '/fixture', hostId: 'local', routeKey: 'local' }
  return changeRecordSchema.parse({
    id,
    revision: 4,
    scope,
    intent: {
      id: emulated ? 'legacy-emulated' : 'source-check',
      kind: 'source-check',
      targetMode: emulated ? 'selected-cloud' : 'none'
    },
    entrances: ['discovery'],
    validations: [{ id: validationId, at: 1, scope, snapshot }],
    reviews: [{ id: reviewId, at: 2, validationId, scope, snapshot }],
    runs: [
      {
        id: randomUUID(),
        at: 3,
        reviewId,
        scope,
        snapshot,
        status: 'passed',
        finishedAt: 4,
        verification: { at: 4, code: 'unchanged' },
        steps: [{ path: 'main.json', code: 'json-valid', at: 3 }]
      }
    ]
  })
}
function seededV4(root: string) {
  const dir = join(root, 'bastion-changes')
  mkdirSync(dir)
  const db = new Database(join(dir, 'changes.db'))
  db.exec(
    'CREATE TABLE change_records (id TEXT PRIMARY KEY, identity TEXT NOT NULL UNIQUE, record TEXT NOT NULL); CREATE TABLE change_aliases (id TEXT PRIMARY KEY, canonicalId TEXT NOT NULL REFERENCES change_records(id)); CREATE TABLE owner_receipts (id TEXT PRIMARY KEY, receipt TEXT NOT NULL); CREATE TABLE cloud_lifecycle_receipts (id TEXT PRIMARY KEY, receipt TEXT NOT NULL); PRAGMA user_version = 4'
  )
  const record = historicalRecord(),
    emulated = historicalRecord(true)
  for (const item of [record, emulated]) {
    db.prepare('INSERT INTO change_records VALUES (?, ?, ?)').run(
      item.id,
      JSON.stringify([item.scope.projectId, item.intent?.id]),
      JSON.stringify(item)
    )
  }
  const alias = randomUUID()
  db.prepare('INSERT INTO change_aliases VALUES (?, ?)').run(alias, record.id)
  // Opaque existing receipt bytes must survive without being decoded or rewritten by migration.
  db.prepare('INSERT INTO owner_receipts VALUES (?, ?)').run(
    'legacy-owner',
    '{"legacy":"source-history"}'
  )
  db.prepare('INSERT INTO cloud_lifecycle_receipts VALUES (?, ?)').run(
    'legacy-floci',
    '{"legacy":"emulated-history"}'
  )
  db.close()
  return { record, alias, emulated }
}
afterEach(() => {
  for (const ledger of ledgers.splice(0)) {
    ledger.close()
  }
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})
describe('RA-10 additive real-read receipts in the existing changes ledger', () => {
  it('migrates a seeded schema 4 to 5 idempotently, preserving aliases and source/emulated receipt bytes', () => {
    const root = directory(),
      legacy = seededV4(root),
      ledger = open(root)
    expect(ledger.get(legacy.alias)).toEqual(legacy.record)
    const second = open(root)
    expect(second.get(legacy.alias)).toEqual(legacy.record)
    expect(second.get(legacy.emulated.id)).toEqual(legacy.emulated)
    const db = new Database(join(root, 'bastion-changes', 'changes.db'))
    try {
      expect(db.pragma('user_version', { simple: true })).toBe(5)
      expect(db.prepare('SELECT * FROM owner_receipts').all()).toEqual([
        { id: 'legacy-owner', receipt: '{"legacy":"source-history"}' }
      ])
      expect(db.prepare('SELECT * FROM cloud_lifecycle_receipts').all()).toEqual([
        { id: 'legacy-floci', receipt: '{"legacy":"emulated-history"}' }
      ])
      expect(db.prepare('SELECT * FROM real_aws_read_receipts').all()).toEqual([])
    } finally {
      db.close()
    }
  })
  it('rolls back failed 4→5 migration without advancing the marker or altering old history', () => {
    const root = directory(),
      legacy = seededV4(root),
      path = join(root, 'bastion-changes', 'changes.db')
    const before = new Database(path)
    before.exec('CREATE VIEW real_aws_read_receipts AS SELECT id FROM change_records')
    before.close()
    expect(() => open(root)).toThrow()
    const after = new Database(path)
    try {
      expect(after.pragma('user_version', { simple: true })).toBe(4)
      expect(after.prepare('SELECT record FROM change_records').get()?.record).toBe(
        JSON.stringify(legacy.record)
      )
    } finally {
      after.close()
    }
  })
  it('atomically deduplicates UUIDs across two connections and rejects operation/context/identity reuse', () => {
    const root = directory(),
      a = open(root),
      b = open(root),
      record = receipt()
    expect(invoke(a, 'admitReadReceipt', record)).toMatchObject({ created: true })
    expect(invoke(b, 'admitReadReceipt', record)).toMatchObject({ created: false, receipt: record })
    for (const changed of [
      { operation: 'resources' },
      { contextFingerprint: `sha256:${'b'.repeat(64)}` },
      { identityFingerprint: `sha256:${'b'.repeat(64)}` },
      { projectId: 'folder:other' },
      { targetId: randomUUID() },
      { namespaceId: 'workspace-other' }
    ]) {
      expect(() => invoke(b, 'admitReadReceipt', { ...record, ...changed })).toThrow()
    }
    expect(invoke(a, 'readReceipt', record.requestId)).toEqual(record)
  })
  it('recovers only a confirmed dead owner as unknown and never invents success or allows replay', () => {
    const root = directory(),
      first = open(root),
      lost = receipt(),
      live = { ...receipt(), ownerRunId: 'owner-live' }
    invoke(first, 'admitReadReceipt', lost)
    invoke(first, 'admitReadReceipt', live)
    const restarted = open(root)
    invoke(restarted, 'recoverReadReceipts', 'owner-a')
    expect(invoke(restarted, 'readReceipt', lost.requestId)).toMatchObject({
      status: 'unknown',
      code: 'interrupted'
    })
    expect(invoke(restarted, 'readReceipt', live.requestId)).toEqual(live)
    expect(invoke(restarted, 'admitReadReceipt', lost)).toMatchObject({
      created: false,
      receipt: { status: 'unknown' }
    })
    expect(() =>
      invoke(first, 'settleReadReceipt', {
        ...lost,
        status: 'completed',
        finishedAt: 2,
        results: []
      })
    ).toThrow()
  })
  it.each([
    'grantId',
    'credentials',
    'source',
    'resourceItems',
    'stdout',
    'stderr',
    'paginationToken',
    'costData'
  ])('rejects private field %s instead of serializing or silently stripping it', (field) => {
    const ledger = open(),
      record = receipt()
    expect(() =>
      invoke(ledger, 'admitReadReceipt', { ...record, [field]: 'PRIVATE_MARKER' })
    ).toThrow()
    expect(invoke(ledger, 'readReceipt', record.requestId)).toBeNull()
  })
  it('settles once with fixed result evidence, rejects owner replacement and preserves history after restart', () => {
    const root = directory(),
      ledger = open(root),
      record = receipt()
    invoke(ledger, 'admitReadReceipt', record)
    expect(() =>
      invoke(ledger, 'settleReadReceipt', {
        ...record,
        ownerRunId: 'foreign-owner',
        status: 'completed',
        finishedAt: 2,
        results: []
      })
    ).toThrow()
    const completed = {
      ...record,
      status: 'completed',
      finishedAt: 2,
      results: [{ code: 'ok', count: 1, truncated: false }]
    }
    invoke(ledger, 'settleReadReceipt', completed)
    expect(invoke(open(root), 'readReceipt', record.requestId)).toEqual(completed)
    expect(() => invoke(ledger, 'settleReadReceipt', completed)).toThrow()
  })
  it('caps new admissions at 10,000 while allowing existing duplicates and active completion', () => {
    const root = directory(),
      ledger = open(root),
      record = receipt()
    invoke(ledger, 'admitReadReceipt', record)
    const db = new Database(join(root, 'bastion-changes', 'changes.db'))
    try {
      db.prepare(
        "WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<9999) INSERT INTO real_aws_read_receipts SELECT printf('00000000-0000-4000-8000-%012d',x), json_set(?, '$.requestId',printf('00000000-0000-4000-8000-%012d',x)) FROM n"
      ).run(JSON.stringify(record))
    } finally {
      db.close()
    }
    expect(() => invoke(ledger, 'admitReadReceipt', receipt())).toThrow(/limit/i)
    expect(invoke(ledger, 'admitReadReceipt', record)).toMatchObject({ created: false })
    invoke(ledger, 'settleReadReceipt', {
      ...record,
      status: 'completed',
      finishedAt: 2,
      results: []
    })
    expect(invoke(ledger, 'readReceipt', record.requestId)).toMatchObject({ status: 'completed' })
  })
  it('refuses newer-schema databases and linked receipt storage without changing their targets', () => {
    const root = directory()
    seededV4(root)
    const path = join(root, 'bastion-changes', 'changes.db'),
      db = new Database(path)
    db.pragma('user_version = 6')
    db.close()
    expect(() => open(root)).toThrow(/version/i)
    const linkedRoot = directory()
    symlinkSync(
      join(root, 'bastion-changes'),
      join(linkedRoot, 'bastion-changes'),
      process.platform === 'win32' ? 'junction' : 'dir'
    )
    expect(() => open(linkedRoot)).toThrow(/private/i)
  })
})
