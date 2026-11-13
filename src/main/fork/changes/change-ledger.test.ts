import { mkdtempSync, rmSync } from 'node:fs'
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
  it('converges two entrances, persists across connections and isolates namespaces and targets', () => {
    const root = directory()
    const a = open(root)
    const first = prepared(a)
    const b = open(root)
    const second = b.ensure(scope, 'source')
    expect(second.id).toBe(first.id)
    expect(second.entrances).toEqual(['discovery', 'source'])
    expect(second.validations).toEqual(first.validations)
    expect(open().ensure(scope, 'source').id).not.toBe(first.id)
    expect(b.ensure({ ...scope, hostId: 'runtime:other' }, 'source').id).not.toBe(first.id)
    expect(b.ensure({ ...scope, root: '/other' }, 'source').id).not.toBe(first.id)
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
