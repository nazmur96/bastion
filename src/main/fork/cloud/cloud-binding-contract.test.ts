import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import Database from '../../sqlite/sync-database'
import { ChangeLedger } from '../changes/change-ledger'
import { CloudTargetCatalog } from './cloud-target-catalog'
import {
  changeIntentSchema,
  changeRecordSchema,
  changeSnapshotSchema,
  currentChangeReview,
  sameChangeSnapshot
} from '../../../shared/fork-changes/change-contract'
import { getDiskBaselineSignature } from '../../../shared/disk-baseline-signature'

const namespaceId = '10000000-0000-4000-8000-000000000001'
const targetId = '20000000-0000-4000-8000-000000000001'
const instanceId = '30000000-0000-4000-8000-000000000001'
const imageDigest =
  'floci/floci@sha256:5ee85db604c4aa74ac76e07ea5cc83086f37bb472bf3dbb97e34019e48efae9c'
const scope = { projectId: 'folder:fixture', root: '/fixture', hostId: 'local', routeKey: 'local' }
const source = {
  adapter: 'source-check/v1',
  files: [{ path: 'app.json', fingerprint: getDiskBaselineSignature('{}') }]
}
const binding = {
  kind: 'emulated-aws',
  namespaceId,
  projectId: scope.projectId,
  targetId,
  selectionGeneration: 3,
  configRevision: 0,
  policyFingerprint: `sha256:${'a'.repeat(64)}`,
  owner: { ...scope, runtimeId: 'fixture-runtime', pairingRevision: 'fixture-pairing' },
  instance: {
    id: instanceId,
    epoch: 1,
    engineId: 'fixture-engine',
    containerId: null,
    imageDigest,
    port: 14566,
    persistenceKey: targetId
  }
}
const roots: string[] = []
const opened: { close(): void }[] = []
afterEach(() => {
  for (const db of opened.splice(0).toReversed()) {
    db.close()
  }
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('9.2 proposed binding contracts — deliberately red until reviewed implementation', () => {
  it('represents explicit targetless source separately from a missing legacy binding', () => {
    expect(
      changeSnapshotSchema.safeParse({ ...source, cloudBinding: { kind: 'none' } }).success
    ).toBe(true)
  })
  it('captures an explicit cloud-bound source snapshot for CT-05', () => {
    expect(changeSnapshotSchema.safeParse({ ...source, cloudBinding: binding }).success).toBe(true)
  })
  it('represents a local lifecycle snapshot without fake source files', () => {
    expect(
      changeSnapshotSchema.safeParse({
        adapter: 'floci-aws-lifecycle/v1',
        operation: 'start',
        cloudBinding: binding,
        policy: { cliVersion: '0.4.0', imageDigest, bindAddress: '127.0.0.1' }
      }).success
    ).toBe(true)
  })
  it('registers cloud lifecycle intents with explicit target mode', () => {
    expect(
      changeIntentSchema.safeParse({
        id: 'cloud:floci-aws:start',
        kind: 'cloud-lifecycle',
        targetMode: 'selected-cloud'
      }).success
    ).toBe(true)
  })
  it('CT-05 detects an A-B-A selection even when target and source bytes return unchanged', () => {
    const root = mkdtempSync(join(tmpdir(), 'cloud-binding-roundtrip-'))
    roots.push(root)
    const catalog = new CloudTargetCatalog(root)
    opened.push(catalog)
    for (const label of ['A', 'B']) {
      catalog.mutate(catalog.snapshot().revision, {
        kind: 'add',
        label,
        configuration: {
          kind: 'emulated',
          provider: 'aws',
          emulator: 'floci',
          cliVersion: '0.4.0',
          runtimeId: 'local'
        }
      })
    }
    const [a, b] = catalog.snapshot().targets
    const owner = { hostId: 'local', root: scope.root } as const
    catalog.select(2, scope.projectId, a.id, owner)
    const before = changeSnapshotSchema.parse({
      ...source,
      cloudBinding: {
        ...binding,
        targetId: a.id,
        selectionGeneration: catalog.snapshot(scope.projectId).selection?.generation
      }
    })
    catalog.select(3, scope.projectId, b.id, owner)
    catalog.select(4, scope.projectId, a.id, owner)
    const after = changeSnapshotSchema.parse({
      ...source,
      cloudBinding: {
        ...binding,
        targetId: a.id,
        selectionGeneration: catalog.snapshot(scope.projectId).selection?.generation
      }
    })
    expect(sameChangeSnapshot(before, after)).toBe(false)
  })
  it('migrates v3 idempotently without binding old Cloud-entrance source history to the current selection', () => {
    const root = mkdtempSync(join(tmpdir(), 'cloud-binding-contract-'))
    roots.push(root)
    const expected = changeRecordSchema.parse({
      id: '40000000-0000-4000-8000-000000000001',
      revision: 6,
      scope,
      intent: { id: 'source-check', kind: 'source-check' },
      entrances: ['cloud'],
      validations: [{ id: 'validation', at: 1, scope, snapshot: source }],
      reviews: [{ id: 'review', at: 2, validationId: 'validation', scope, snapshot: source }],
      runs: [
        {
          id: 'run',
          at: 3,
          reviewId: 'review',
          snapshot: source,
          scope,
          steps: [{ path: 'app.json', code: 'json-valid', at: 4 }],
          status: 'passed',
          finishedAt: 5,
          verification: { at: 6, code: 'unchanged' }
        }
      ]
    })
    mkdirSync(join(root, 'bastion-changes'), { mode: 0o700 })
    const file = join(root, 'bastion-changes', 'changes.db')
    const old = new Database(file)
    opened.push(old)
    old.exec(
      'CREATE TABLE change_records (id TEXT PRIMARY KEY, identity TEXT NOT NULL UNIQUE, record TEXT NOT NULL); CREATE TABLE change_aliases (id TEXT PRIMARY KEY, canonicalId TEXT NOT NULL REFERENCES change_records(id)); CREATE TABLE owner_receipts (id TEXT PRIMARY KEY, receipt TEXT NOT NULL); PRAGMA user_version = 3;'
    )
    old
      .prepare('INSERT INTO change_records VALUES (?, ?, ?)')
      .run(expected.id, JSON.stringify([scope.projectId, 'source-check']), JSON.stringify(expected))
    old.prepare('INSERT INTO change_aliases VALUES (?, ?)').run('legacy-alias', expected.id)
    const cloud = new CloudTargetCatalog(root)
    opened.push(cloud)
    cloud.mutate(0, {
      kind: 'add',
      label: 'Current selection must not change history',
      configuration: {
        kind: 'emulated',
        provider: 'aws',
        emulator: 'floci',
        cliVersion: '0.4.0',
        runtimeId: 'local'
      }
    })
    cloud.select(1, scope.projectId, cloud.snapshot().targets[0].id, {
      hostId: 'local',
      root: scope.root
    })
    const reopened = new ChangeLedger(root)
    opened.push(reopened)
    expect(old.pragma('user_version', { simple: true })).toBe(4)
    const restored = reopened.list(scope.projectId)[0]
    expect(restored.id).toBe(expected.id)
    expect(restored.runs).toEqual(expected.runs)
    expect(currentChangeReview(restored)).toBeDefined()
    expect(restored.reviews[0].snapshot).toEqual(expected.reviews[0].snapshot)
    expect(reopened.get('legacy-alias').id).toBe(expected.id)
    const again = new ChangeLedger(root)
    opened.push(again)
    expect(again.list(scope.projectId)[0].runs).toEqual(expected.runs)
  })
})
