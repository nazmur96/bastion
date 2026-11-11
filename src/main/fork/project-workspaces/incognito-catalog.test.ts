import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  symlinkSync
} from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, expect, it } from 'vitest'
import Database from '../../sqlite/sync-database'
import { WorkspaceCatalog } from './workspace-catalog'
import { validateIncognitoFileName } from './incognito-catalog'
import { daemonRuntimeDirFor } from '../../daemon/daemon-runtime-dir'

const roots: string[] = []
function root(): string {
  const path = mkdtempSync(join(tmpdir(), 'bastion-incognito-'))
  roots.push(path)
  return path
}
afterEach(() => {
  for (const path of roots.splice(0)) {
    rmSync(path, { recursive: true, force: true })
  }
})

it('keeps tasks out of Home cards and restores their own archive and scratch files', () => {
  const path = root()
  let catalog = new WorkspaceCatalog(path)
  const regular = catalog.create('Retail')
  const task = catalog.incognito().create('file', 'main.tf', 'codex')
  const other = catalog.incognito().create('terminal', undefined, undefined)
  const scratch = catalog.incognito().scratch(task.workspace.id)
  writeFileSync(join(scratch, 'main.tf'), '# preserved')
  expect(catalog.list().map((row) => row.id)).toEqual(['existing', regular.id])
  expect(catalog.dataRoot(task.workspace.id)).not.toBe(catalog.dataRoot(other.workspace.id))
  catalog.incognito().markActive(task.workspace.id)
  catalog.incognito().archiveOwn(task.workspace.id)
  catalog.close()
  catalog = new WorkspaceCatalog(path)
  try {
    expect(catalog.incognito().get(task.workspace.id)).toMatchObject({
      kind: 'file',
      fileName: 'main.tf',
      agent: 'codex',
      archivedAt: expect.any(Number)
    })
    expect(
      readFileSync(join(catalog.incognito().scratch(task.workspace.id), 'main.tf'), 'utf8')
    ).toBe('# preserved')
  } finally {
    catalog.close()
  }
})

it('refuses deletion of a live owner and removes only a stopped task namespace', async () => {
  const path = root(),
    external = root()
  const catalog = new WorkspaceCatalog(path)
  try {
    const live = catalog.incognito().create('terminal', undefined, undefined)
    catalog.incognito().markActive(live.workspace.id)
    catalog.enterHome()
    await expect(catalog.incognito().remove(live.workspace.id)).rejects.toThrow(/still running/)
    const closed = catalog.incognito().create('browser', undefined, undefined)
    const data = catalog.dataRoot(closed.workspace.id)
    const daemonDirectory = daemonRuntimeDirFor(data)
    mkdirSync(daemonDirectory, { recursive: true })
    const pidFile = join(daemonDirectory, 'daemon-v1.pid')
    writeFileSync(pidFile, JSON.stringify({ pid: process.pid }))
    await expect(catalog.incognito().remove(closed.workspace.id)).rejects.toThrow(
      /terminal runtime/
    )
    expect(catalog.incognito().get(closed.workspace.id)?.deleting).toBe(false)
    rmSync(pidFile)
    mkdirSync(join(data, 'saved'), { recursive: true })
    writeFileSync(join(data, 'saved', 'session'), 'test')
    writeFileSync(join(external, 'keep'), 'external source')
    symlinkSync(external, join(data, 'external'), process.platform === 'win32' ? 'junction' : 'dir')
    await catalog.incognito().remove(closed.workspace.id)
    expect(existsSync(data)).toBe(false)
    expect(catalog.incognito().get(closed.workspace.id)).toBeNull()
    expect(readFileSync(join(external, 'keep'), 'utf8')).toBe('external source')
    expect(catalog.get('existing').id).toBe('existing')
    await expect(catalog.incognito().remove('existing')).rejects.toThrow()
  } finally {
    catalog.close()
  }
})

it('upgrades version two without losing projects and rejects unsafe scratch names', () => {
  const path = root()
  let catalog = new WorkspaceCatalog(path)
  const regular = catalog.create('Before upgrade')
  catalog.close()
  const db = new Database(join(path, 'bastion-project-workspaces', 'catalog.db'))
  db.exec('DROP TABLE incognito; PRAGMA user_version = 2;')
  db.close()
  catalog = new WorkspaceCatalog(path)
  try {
    expect(catalog.get(regular.id).name).toBe('Before upgrade')
    expect(catalog.incognito().list()).toEqual([])
    for (const name of ['../outside.tf', '..', 'dir/file.py', 'dir\\file.py', 'bad\nname']) {
      expect(() => validateIncognitoFileName(name)).toThrow()
    }
    expect(validateIncognitoFileName('main.tf')).toBe('main.tf')
    expect(validateIncognitoFileName('script.py')).toBe('script.py')
    expect(() => catalog.incognito().create('agent', undefined, 'unknown-agent')).toThrow(
      /supported agent/
    )
  } finally {
    catalog.close()
  }
})
