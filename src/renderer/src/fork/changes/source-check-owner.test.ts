import { beforeEach, describe, expect, it, vi } from 'vitest'
import { UNRESOLVED_OWNER_HOST_ID } from '../../../../shared/execution-host'

const m = vi.hoisted(() => ({
  host: 'runtime:test',
  managed: true,
  dir: vi.fn(),
  stat: vi.fn(),
  read: vi.fn(),
  guard: vi.fn()
}))
vi.mock('../workbench/start-project-actions', () => ({ startWorkspaceHost: () => m.host }))
vi.mock('../environments/workspace-environment-files', () => ({
  captureProjectFileRoute: () => {
    const target = m.managed ? { kind: 'environment', environmentId: 'test' } : { kind: 'local' }
    return {
      root: '/fixture',
      guard: { assertCurrent: m.guard, route: { target } },
      context: { target, worktreeId: 'wt', worktreePath: '/fixture' }
    }
  }
}))
vi.mock('@/runtime/runtime-file-mutation-client', () => ({ readRuntimeDirectory: m.dir }))
vi.mock('@/runtime/runtime-file-range-client', () => ({
  statRuntimeReadTarget: m.stat,
  readRuntimeFileRange: m.read
}))
import { captureSourceCheckOwner, checkSourceText } from './source-check-owner'
import { getDiskBaselineSignature } from '../../../../shared/disk-baseline-signature'

beforeEach(() => {
  vi.resetAllMocks()
  m.host = 'runtime:test'
  m.managed = true
  m.dir.mockResolvedValue([{ name: 'package.json', isDirectory: false, isSymlink: false }])
  m.stat.mockResolvedValue({ size: 2, mtime: 1, isDirectory: false })
  m.read.mockResolvedValue(new TextEncoder().encode('{}'))
})
describe('source-check file ownership', () => {
  it('reads remote source only through its captured runtime route', async () => {
    const owner = captureSourceCheckOwner('wt')
    const snapshot = await owner.snapshot(['package.json'])
    expect(snapshot.files[0].fingerprint).toBe(getDiskBaselineSignature('{}'))
    expect(m.read.mock.calls[0][0]).toMatchObject({
      target: { kind: 'environment', environmentId: 'test' },
      worktreeId: 'wt',
      relativePath: 'package.json',
      filePath: '/fixture/package.json'
    })
  })
  it('supports a proven local folder owner through the same transport', async () => {
    m.host = 'local'
    m.managed = false
    await captureSourceCheckOwner('folder:fixture').snapshot(['package.json'])
    expect(m.read.mock.calls[0][0].target).toEqual({ kind: 'local' })
  })
  it('refuses unresolved and unmanaged remote owners before any filesystem operation', () => {
    m.host = UNRESOLVED_OWNER_HOST_ID
    expect(() => captureSourceCheckOwner('wt')).toThrow('unresolved')
    m.host = 'ssh:test'
    m.managed = false
    expect(() => captureSourceCheckOwner('wt')).toThrow('managed runtime')
    expect(m.dir).not.toHaveBeenCalled()
  })
  it('rejects sensitive paths, traversal and symlinks before reading bytes', async () => {
    const owner = captureSourceCheckOwner('wt')
    await expect(owner.read('../package.json')).rejects.toThrow()
    await expect(owner.read('secrets.json')).rejects.toThrow()
    m.dir.mockResolvedValue([{ name: 'package.json', isDirectory: false, isSymlink: true }])
    await expect(owner.read('package.json')).rejects.toThrow('symlinked')
    expect(m.read).not.toHaveBeenCalled()
  })
  it('fails closed after disconnect, host change, oversize or a read race', async () => {
    const owner = captureSourceCheckOwner('wt')
    m.guard.mockImplementationOnce(() => {
      throw new Error('Disconnected')
    })
    await expect(owner.read('package.json')).rejects.toThrow('Disconnected')
    m.host = 'local'
    await expect(owner.read('package.json')).rejects.toThrow('owner changed')
    m.host = 'runtime:test'
    m.stat.mockResolvedValueOnce({ size: 65537 })
    await expect(owner.read('package.json')).rejects.toThrow('64 KiB')
    m.stat.mockResolvedValueOnce({ size: 2, mtime: 1 }).mockResolvedValueOnce({ size: 2, mtime: 2 })
    await expect(owner.read('package.json')).rejects.toThrow('changed during')
  })
  it('handles empty files and does not persist JSON parser messages or contents', async () => {
    m.stat.mockResolvedValue({ size: 0, mtime: 1 })
    expect(await captureSourceCheckOwner('wt').read('package.json')).toBe('')
    expect(m.read).not.toHaveBeenCalled()
    expect(
      checkSourceText(
        'package.json',
        '{"private":"value",',
        getDiskBaselineSignature('{"private":"value",')
      )
    ).toBe('json-invalid')
    expect(checkSourceText('main.tf', '', getDiskBaselineSignature(''))).toBe('readable')
  })
})
