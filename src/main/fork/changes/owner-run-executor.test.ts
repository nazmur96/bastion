import { randomUUID } from 'node:crypto'
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { getDiskBaselineSignature } from '../../../shared/disk-baseline-signature'
import type { OwnerRunReceipt } from '../../../shared/fork-changes/change-contract'
import { ChangeLedger } from './change-ledger'
import { createOwnerSource, readOwnerSource } from './owner-source-files'
import { executeOwnerRun } from './owner-run-executor'

const roots: string[] = []
function directory(): string {
  const root = mkdtempSync(join(tmpdir(), 'bastion-owner-run-'))
  roots.push(root)
  return root
}
function receipt(
  root: string,
  files: [string, string][],
  adapter: OwnerRunReceipt['snapshot']['adapter'] = 'source-check/v1'
): OwnerRunReceipt {
  return {
    id: randomUUID(),
    runtimeId: 'test-runtime',
    ownerPid: process.pid,
    worktreeId: 'fixture',
    root,
    snapshot: {
      adapter,
      ownerRuntimeId: 'test-runtime',
      files: files.map(([path, text]) => ({ path, fingerprint: getDiskBaselineSignature(text) }))
    },
    at: Date.now(),
    steps: [],
    status: 'running',
    finishedAt: null,
    verification: null
  }
}
afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true })
  }
})

describe('owner execution and source publication', () => {
  it('persists actual partial failure and not-run evidence independently of the renderer', async () => {
    const root = directory()
    writeFileSync(join(root, 'a.json'), '{}')
    writeFileSync(join(root, 'b.json'), '{')
    writeFileSync(join(root, 'c.json'), '{}')
    const run = receipt(root, [
      ['a.json', '{}'],
      ['b.json', '{'],
      ['c.json', '{}']
    ])
    const ledger = new ChangeLedger(directory())
    try {
      ledger.admitReceipt(run)
      await executeOwnerRun(run, root, undefined, (next) => ledger.saveReceipt(next))
      expect(ledger.receipt(run.id)).toMatchObject({
        status: 'failed',
        steps: [
          { path: 'a.json', code: 'json-valid' },
          { path: 'b.json', code: 'json-invalid' }
        ],
        verification: { code: 'unchanged' }
      })
      expect(run.steps.some((step) => step.path === 'c.json')).toBe(false)
      expect(JSON.stringify(ledger.receipt(run.id))).not.toContain('Unexpected')
      expect(ledger.admitReceipt(receipt(root, [['a.json', '{}']])).created).toBe(true)
    } finally {
      ledger.close()
    }
  })

  it('makes duplicate run admission idempotent and preserves durable evidence across connections', async () => {
    const root = directory(),
      storage = directory()
    writeFileSync(join(root, 'a.json'), '{}')
    const run = receipt(root, [['a.json', '{}']])
    const first = new ChangeLedger(storage),
      second = new ChangeLedger(storage)
    try {
      expect(first.admitReceipt(run).created).toBe(true)
      expect(second.admitReceipt(run).created).toBe(false)
      await executeOwnerRun(run, root, undefined, (next) => first.saveReceipt(next))
      expect(second.receipt(run.id)?.status).toBe('passed')
      expect(second.admitReceipt(run)).toEqual({ receipt: run, created: false })
      expect(() => first.admitReceipt({ ...run, root: '/different' })).toThrow('different request')
    } finally {
      first.close()
      second.close()
    }
  })

  it('detects a saved edit during execution without erasing the earlier checkpoint', async () => {
    const root = directory()
    writeFileSync(join(root, 'a.json'), '{}')
    writeFileSync(join(root, 'b.json'), '{}')
    const run = receipt(root, [
      ['a.json', '{}'],
      ['b.json', '{}']
    ])
    const checkpoints: OwnerRunReceipt[] = []
    await executeOwnerRun(run, root, undefined, (next) => {
      checkpoints.push(structuredClone(next))
      if (next.steps.length === 1) {
        writeFileSync(join(root, 'b.json'), '{"human":"edit"}')
      }
    })
    expect(checkpoints[0].steps).toEqual([
      expect.objectContaining({ path: 'a.json', code: 'json-valid' })
    ])
    expect(run).toMatchObject({
      status: 'failed',
      steps: [{ code: 'json-valid' }, { code: 'changed' }],
      verification: { code: 'changed' }
    })
  })

  it('creates ordinary source and never replaces an existing or edited destination', async () => {
    const root = directory()
    const results = await Promise.all([
      createOwnerSource(root, 'service.json', '{"writer":1}'),
      createOwnerSource(root, 'service.json', '{"writer":2}')
    ])
    expect(results.sort()).toEqual(['conflict', 'created'])
    const created = readFileSync(join(root, 'service.json'), 'utf8')
    expect(['{"writer":1}', '{"writer":2}']).toContain(created)
    writeFileSync(join(root, 'service.json'), '{"human":"kept"}')
    expect(await createOwnerSource(root, 'service.json', '{}')).toBe('conflict')
    expect(readFileSync(join(root, 'service.json'), 'utf8')).toBe('{"human":"kept"}')
    expect(readdirSync(root)).toEqual(['service.json'])
  })

  it.skipIf(process.platform === 'win32')(
    'creates source with the usual umask-derived mode, readable by build tools',
    async () => {
      const root = directory()
      expect(await createOwnerSource(root, 'service.json', '{}')).toBe('created')
      const umask = process.umask()
      expect(lstatSync(join(root, 'service.json')).mode & 0o777).toBe(0o666 & ~umask)
    }
  )

  it.skipIf(process.platform === 'win32')(
    'refuses existing and dangling symlink destinations without touching their targets',
    async () => {
      const root = directory(),
        outside = directory()
      writeFileSync(join(outside, 'existing.json'), '{"outside":"kept"}')
      symlinkSync(join(outside, 'existing.json'), join(root, 'existing.json'))
      symlinkSync(join(outside, 'missing.json'), join(root, 'missing.json'))
      expect(await createOwnerSource(root, 'existing.json', '{}')).toBe('conflict')
      expect(await createOwnerSource(root, 'missing.json', '{}')).toBe('conflict')
      expect(readFileSync(join(outside, 'existing.json'), 'utf8')).toBe('{"outside":"kept"}')
      expect(existsSync(join(outside, 'missing.json'))).toBe(false)
      await expect(readOwnerSource(root, 'existing.json')).rejects.toThrow('symlink')
    }
  )

  it('keeps creation and source verification separate, and excludes unsafe proposals', async () => {
    const root = directory(),
      content = '{"reviewed":true}'
    const run = receipt(root, [['service.json', content]], 'create-file/v1')
    await executeOwnerRun(run, root, content, () => {})
    expect(run).toMatchObject({
      status: 'passed',
      steps: [{ code: 'created' }],
      verification: { code: 'unchanged' }
    })
    await expect(createOwnerSource(root, '../outside.json', '{}')).rejects.toThrow('bounds')
    await expect(createOwnerSource(root, 'secrets.json', '{}')).rejects.toThrow('bounds')
    await expect(
      createOwnerSource(root, 'invalid.json', '{"private":"must-not-be-in-error",')
    ).rejects.toThrow('Proposal JSON is invalid.')
    expect(existsSync(join(root, 'invalid.json'))).toBe(false)
  })
})
