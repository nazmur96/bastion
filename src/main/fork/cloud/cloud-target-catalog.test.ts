import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  mkdirSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import Database from '../../sqlite/sync-database'
import { CloudTargetCatalog } from './cloud-target-catalog'

const roots: string[] = []
const catalogs: CloudTargetCatalog[] = []
function root() {
  const p = mkdtempSync(join(tmpdir(), 'cloud-catalog-'))
  roots.push(p)
  return p
}
function open(p = root()) {
  const c = new CloudTargetCatalog(p)
  catalogs.push(c)
  return c
}
const input = {
  label: 'Fixture',
  configuration: {
    kind: 'real',
    provider: 'aws',
    profileName: 'fixture-profile',
    region: 'us-east-1'
  }
} as const
const owner = { hostId: 'local', root: '/fixture' } as const

afterEach(() => {
  for (const c of catalogs.splice(0)) {
    c.close()
  }
  for (const p of roots.splice(0)) {
    rmSync(p, { recursive: true, force: true })
  }
})
describe('workspace cloud catalog', () => {
  it('isolates catalogs, persists metadata and tombstones removal without credentials', () => {
    const p = root(),
      a = open(p),
      b = open()
    a.mutate(0, { kind: 'add', ...input })
    const target = a.snapshot().targets[0]
    expect(b.snapshot().targets).toEqual([])
    expect(() => b.mutate(0, { kind: 'rename', id: target.id, label: 'Foreign' })).toThrow(
      'Target is unavailable'
    )
    a.mutate(1, { kind: 'rename', id: target.id, label: 'Renamed' })
    expect(open(p).snapshot().targets[0]).toMatchObject({
      id: target.id,
      label: 'Renamed',
      configRevision: 0
    })
    a.mutate(2, { kind: 'remove', id: target.id })
    expect(a.snapshot().targets).toEqual([])
  })
  it('rejects stale writers and fences A-B-A selections with monotonic generations', () => {
    const p = root(),
      a = open(p),
      b = open(p)
    a.mutate(0, { kind: 'add', ...input })
    expect(() => b.mutate(0, { kind: 'add', ...input })).toThrow('Cloud targets changed')
    const id = a.snapshot().targets[0].id
    a.select(1, 'project', id, owner)
    a.select(2, 'project', null, owner)
    a.select(3, 'project', id, owner)
    expect(b.snapshot('project').selection).toMatchObject({ targetId: id, generation: 3 })
    expect(b.snapshot('sibling').selection).toBeNull()
    a.mutate(4, { kind: 'remove', id })
    expect(a.snapshot('project').selection).toMatchObject({ targetId: null, generation: 4 })
  })
  it('rejects secret-bearing and executable configuration before storage', () => {
    const p = root(),
      c = open(p)
    for (const extra of [
      { token: 'PLANTED_SECRET' },
      { endpoint: 'https://example.com' },
      { env: { AWS_SECRET_ACCESS_KEY: 'PLANTED_SECRET' } }
    ]) {
      expect(() => c.mutate(0, { kind: 'add', ...input, ...extra })).toThrow(
        'Invalid cloud target metadata'
      )
    }
    expect(() => c.mutate(0, { kind: 'apply' })).toThrow('Invalid cloud target metadata')
    expect(c.snapshot().revision).toBe(0)
    for (const file of readdirSync(join(p, 'bastion-cloud'))) {
      expect(
        readFileSync(join(p, 'bastion-cloud', file)).includes(Buffer.from('PLANTED_SECRET'))
      ).toBe(false)
    }
  })
  it('refuses directory/database symlinks and newer schemas without rewriting them', () => {
    const p = root(),
      destination = root()
    symlinkSync(destination, join(p, 'bastion-cloud'), 'dir')
    expect(() => open(p)).toThrow()
    const q = root()
    mkdirSync(join(q, 'bastion-cloud'))
    const file = join(q, 'bastion-cloud', 'targets.db')
    symlinkSync(join(destination, 'absent'), file)
    expect(() => open(q)).toThrow()
    const r = root()
    mkdirSync(join(r, 'bastion-cloud'))
    const db = new Database(join(r, 'bastion-cloud', 'targets.db'))
    db.pragma('user_version = 99')
    db.close()
    expect(() => open(r)).toThrow('Cloud target storage is newer')
  })
  it('creates private directories and SQLite files', () => {
    const p = root()
    open(p)
    if (process.platform !== 'win32') {
      expect(statSync(join(p, 'bastion-cloud')).mode & 0o777).toBe(0o700)
      for (const suffix of ['', '-wal', '-shm']) {
        expect(statSync(join(p, 'bastion-cloud', `targets.db${suffix}`)).mode & 0o777).toBe(0o600)
      }
    }
  })
})
