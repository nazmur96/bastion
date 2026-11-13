import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import Database from '../../sqlite/sync-database'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { getDiskBaselineSignature } from '../../../shared/disk-baseline-signature'
import {
  changeCommandSchema,
  changePathSchema,
  currentChangeReview,
  type ChangeRecord,
  type ChangeScope,
  type ChangeSnapshot
} from '../../../shared/fork-changes/change-contract'
import { ChangeLedger } from './change-ledger'

const roots: string[] = []
const ledgers: ChangeLedger[] = []
const scope: ChangeScope = {
  projectId: 'folder:fixture',
  root: '/fixture',
  hostId: 'local',
  routeKey: 'local'
}
const snapshot: ChangeSnapshot = {
  adapter: 'source-check/v1',
  files: [
    { path: 'a.json', fingerprint: getDiskBaselineSignature('{}') },
    { path: 'b.json', fingerprint: getDiskBaselineSignature('{') }
  ]
}
function directory(): string {
  const root = mkdtempSync(join(tmpdir(), 'bastion-change-'))
  roots.push(root)
  return root
}
function open(root = directory()): ChangeLedger {
  const ledger = new ChangeLedger(root)
  ledgers.push(ledger)
  return ledger
}
function prepared(ledger: ChangeLedger): ChangeRecord {
  const record = ledger.ensure(scope, 'discovery')
  return ledger.command(record.id, record.revision, { kind: 'validate', snapshot })
}
function reviewed(ledger: ChangeLedger): ChangeRecord {
  const record = prepared(ledger)
  return ledger.command(record.id, record.revision, {
    kind: 'review',
    validationId: record.validations[0].id,
    snapshot
  })
}
afterEach(() => {
  for (const ledger of ledgers.splice(0)) {
    ledger.close()
  }
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true })
  }
})

describe('namespace-owned change ledger', () => {
  it('converges entrances, isolates namespaces and keeps history when the target changes', () => {
    const root = directory()
    const a = open(root)
    const first = prepared(a)
    const b = open(root)
    const second = b.ensure(scope, 'source')
    expect(second.id).toBe(first.id)
    expect(second.entrances).toEqual(['discovery', 'source'])
    expect(second.validations).toEqual(first.validations)
    expect(open().ensure(scope, 'source').id).not.toBe(first.id)
    expect(b.ensure({ ...scope, hostId: 'runtime:other' }, 'source').id).toBe(first.id)
    expect(b.ensure({ ...scope, root: '/other' }, 'source').id).toBe(first.id)
    expect(b.ensure({ ...scope, projectId: 'other-project' }, 'source').id).not.toBe(first.id)
  })

  it('preserves pinned contexts and invalidates reviews across a genuine re-pair', () => {
    const ledger = open()
    let record = reviewed(ledger)
    record = ledger.command(record.id, record.revision, {
      kind: 'start',
      reviewId: record.reviews[0].id,
      snapshot
    })
    const changed = ledger.ensure({ ...scope, routeKey: 'new-pairing' }, 'source')
    expect(changed.id).toBe(record.id)
    expect(currentChangeReview(changed)).toBeUndefined()
    expect(changed.runs[0].scope).toEqual(scope)
    const finished = ledger.command(record.id, record.revision, {
      kind: 'finish',
      runId: record.runs[0].id
    })
    expect(finished.scope.routeKey).toBe('new-pairing')
    expect(finished.runs[0]).toMatchObject({ status: 'failed', scope })
    expect(ledger.list(scope.projectId)).toHaveLength(1)
  })

  it('keeps independent intents in the same project without substituting their kinds', () => {
    const ledger = open()
    const first = prepared(ledger)
    const second = ledger.ensure(scope, 'recipes', {
      id: 'file:bastion.service.json',
      kind: 'create-file'
    })
    expect(second.id).not.toBe(first.id)
    expect(ledger.list(scope.projectId)).toHaveLength(2)
    expect(() =>
      ledger.ensure(scope, 'source', { id: 'source-check', kind: 'create-file' })
    ).toThrow('kind')
  })

  it('does not revive a review after an owner round trip or identical re-preparation', () => {
    const ledger = open()
    const record = reviewed(ledger)
    ledger.ensure({ ...scope, routeKey: 'another-pairing' }, 'source')
    let restored = ledger.ensure(scope, 'source')
    expect(currentChangeReview(restored)).toBeUndefined()
    restored = ledger.command(restored.id, restored.revision, { kind: 'validate', snapshot })
    expect(currentChangeReview(restored)).toBeUndefined()
    expect(restored.reviews[0]).toEqual(record.reviews[0])
  })

  it('keeps owner attempts alive across renderer interruption and accepts only matching monotonic receipts', () => {
    const ledger = open()
    const pinned = { ...snapshot, ownerRuntimeId: 'runtime-one' }
    let record = ledger.ensure(scope, 'source')
    record = ledger.command(record.id, record.revision, { kind: 'validate', snapshot: pinned })
    record = ledger.command(record.id, record.revision, {
      kind: 'review',
      validationId: record.validations[0].id,
      snapshot: pinned
    })
    record = ledger.command(record.id, record.revision, {
      kind: 'start',
      reviewId: record.reviews[0].id,
      snapshot: pinned,
      execution: { runtimeId: 'runtime-one' }
    })
    const run = record.runs[0]
    ledger.interruptRunning()
    expect(ledger.get(record.id).runs[0].status).toBe('running')
    expect(() =>
      ledger.command(record.id, record.revision, {
        kind: 'step',
        runId: run.id,
        path: 'a.json',
        code: 'json-valid'
      })
    ).toThrow('only owner receipts')
    const receipt = {
      id: run.id,
      runtimeId: 'runtime-one',
      ownerPid: process.pid,
      worktreeId: scope.projectId,
      root: scope.root,
      snapshot: pinned,
      at: run.at,
      steps: [{ path: 'a.json', code: 'json-valid' as const, at: 1 }],
      status: 'failed' as const,
      finishedAt: 2,
      verification: { at: 2, code: 'unchanged' as const }
    }
    expect(() =>
      ledger.command(record.id, record.revision, {
        kind: 'reconcile',
        receipt: { ...receipt, root: '/wrong' }
      })
    ).toThrow('pinned run')
    record = ledger.command(record.id, record.revision, { kind: 'reconcile', receipt })
    expect(record.runs[0]).toMatchObject({
      status: 'failed',
      steps: receipt.steps,
      verification: receipt.verification
    })
    expect(() =>
      ledger.command(record.id, record.revision, {
        kind: 'reconcile',
        receipt: { ...receipt, steps: [] }
      })
    ).toThrow('settled')
  })

  it('merges version-1 pairing records without discarding old evidence or identifiers', () => {
    const root = directory()
    const records = [reviewed(open()), reviewed(open())]
    records[1].scope = { ...scope, routeKey: 'another-pairing' }
    for (const record of records) {
      delete record.intent
      for (const item of [...record.validations, ...record.reviews, ...record.runs]) {
        delete item.scope
      }
    }
    mkdirSync(join(root, 'bastion-changes'))
    const old = new Database(join(root, 'bastion-changes', 'changes.db'))
    old.exec(
      'CREATE TABLE changes (id TEXT PRIMARY KEY, scope TEXT NOT NULL UNIQUE, record TEXT NOT NULL); PRAGMA user_version = 1;'
    )
    for (const record of records) {
      old
        .prepare('INSERT INTO changes VALUES (?, ?, ?)')
        .run(record.id, JSON.stringify(record.scope), JSON.stringify(record))
    }
    old.close()
    const upgraded = open(root)
    const merged = upgraded.list(scope.projectId)
    expect(merged).toHaveLength(1)
    expect(merged[0].validations).toHaveLength(2)
    expect(merged[0].reviews).toHaveLength(2)
    expect(upgraded.get(records[0].id).id).toBe(upgraded.get(records[1].id).id)
    expect(merged[0].reviews.map((review) => review.scope?.routeKey).sort()).toEqual([
      'another-pairing',
      'local'
    ])
    expect(open(root).list(scope.projectId)).toEqual(merged)
  })

  it('rejects stale writers, stale source and review before preparation', () => {
    const ledger = open()
    const record = prepared(ledger)
    expect(() =>
      ledger.command(record.id, record.revision - 1, { kind: 'validate', snapshot })
    ).toThrow('updated elsewhere')
    expect(() =>
      ledger.command(record.id, record.revision, {
        kind: 'review',
        validationId: 'wrong',
        snapshot
      })
    ).toThrow('source changed')
    const changed = {
      ...snapshot,
      files: [{ path: 'a.json', fingerprint: getDiskBaselineSignature('changed') }]
    }
    expect(() =>
      ledger.command(record.id, record.revision, {
        kind: 'review',
        validationId: record.validations[0].id,
        snapshot: changed
      })
    ).toThrow('source changed')
  })

  it('invalidates review after preparation changes and refuses a mismatching execution snapshot', () => {
    const ledger = open()
    const record = reviewed(ledger)
    const review = record.reviews[0]
    const changed: ChangeSnapshot = { ...snapshot, files: snapshot.files.slice(0, 1) }
    expect(() =>
      ledger.command(record.id, record.revision, {
        kind: 'start',
        reviewId: review.id,
        snapshot: changed
      })
    ).toThrow('stale')
    const next = ledger.command(record.id, record.revision, { kind: 'validate', snapshot: changed })
    expect(currentChangeReview(next)).toBeUndefined()
    expect(next.reviews).toEqual(record.reviews)
  })

  it('keeps pinned partial failures across a retry, fences steps and makes verification write-once', () => {
    const ledger = open()
    let record = reviewed(ledger)
    record = ledger.command(record.id, record.revision, {
      kind: 'start',
      reviewId: record.reviews[0].id,
      snapshot
    })
    const runId = record.runs[0].id
    expect(() =>
      ledger.command(record.id, record.revision, {
        kind: 'step',
        runId,
        path: 'b.json',
        code: 'json-valid'
      })
    ).toThrow('pinned plan')
    record = ledger.command(record.id, record.revision, {
      kind: 'step',
      runId,
      path: 'a.json',
      code: 'json-valid'
    })
    record = ledger.command(record.id, record.revision, {
      kind: 'step',
      runId,
      path: 'b.json',
      code: 'json-invalid'
    })
    record = ledger.command(record.id, record.revision, { kind: 'finish', runId })
    expect(record.runs[0].status).toBe('failed')
    record = ledger.command(record.id, record.revision, {
      kind: 'verify',
      runId,
      code: 'unchanged'
    })
    const failed = structuredClone(record.runs[0])
    expect(() =>
      ledger.command(record.id, record.revision, { kind: 'verify', runId, code: 'changed' })
    ).toThrow('unverified')
    expect(() =>
      ledger.command(record.id, record.revision, {
        kind: 'step',
        runId,
        path: 'b.json',
        code: 'json-valid'
      })
    ).toThrow('finished')
    record = ledger.command(record.id, record.revision, {
      kind: 'start',
      reviewId: record.reviews[0].id,
      snapshot
    })
    expect(record.runs[0]).toEqual(failed)
    expect(record.runs[1].snapshot).toEqual(failed.snapshot)
    expect(record.runs[1].id).not.toBe(runId)
    expect(record.scope).toEqual(scope)
  })

  it('recovers interrupted attempts without losing completed steps or inventing success', () => {
    const ledger = open()
    let record = reviewed(ledger)
    record = ledger.command(record.id, record.revision, {
      kind: 'start',
      reviewId: record.reviews[0].id,
      snapshot
    })
    record = ledger.command(record.id, record.revision, {
      kind: 'step',
      runId: record.runs[0].id,
      path: 'a.json',
      code: 'json-valid'
    })
    ledger.interruptRunning()
    const recovered = ledger.ensure(scope, 'source')
    expect(recovered.runs[0]).toMatchObject({
      status: 'interrupted',
      verification: null,
      steps: record.runs[0].steps
    })
    ledger.interruptRunning()
    expect(ledger.ensure(scope, 'source').revision).toBe(recovered.revision)
  })

  it.each([
    '../a.json',
    '/a.json',
    'C:/a.json',
    'a\\b.json',
    '.env.json',
    'x.tfvars.json',
    'secret.yaml',
    'credentials.json',
    'x.tfstate.json',
    'node_modules/x.json',
    '.git/x.json'
  ])('refuses unsafe or sensitive path %s', (path) => {
    expect(changePathSchema.safeParse(path).success).toBe(false)
  })

  it('rejects raw source, commands, arbitrary adapter names and duplicate snapshot paths', () => {
    expect(
      changeCommandSchema.safeParse({
        kind: 'start',
        reviewId: 'a',
        snapshot,
        command: 'terraform apply'
      }).success
    ).toBe(false)
    expect(
      changeCommandSchema.safeParse({
        kind: 'validate',
        snapshot: { ...snapshot, source: 'secret' }
      }).success
    ).toBe(false)
    expect(
      changeCommandSchema.safeParse({
        kind: 'validate',
        snapshot: { ...snapshot, adapter: 'shell' }
      }).success
    ).toBe(false)
    expect(
      changeCommandSchema.safeParse({
        kind: 'validate',
        snapshot: { ...snapshot, files: [snapshot.files[0], snapshot.files[0]] }
      }).success
    ).toBe(false)
  })
})
