import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { WorkspaceCatalog } from './workspace-catalog'
import { configureProjectWorkspace } from './workspace-context'
import { registerProjectWorkspaceHandlers } from './workspace-ipc'
import { Store } from '../../persistence'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  flush: vi.fn(),
  destination: vi.fn(async () => {}),
  quit: vi.fn()
}))
vi.mock('./workspace-destination', () => ({ openProjectWorkspaceDestination: mocks.destination }))
vi.mock('./workspace-arrival', () => ({ registerProjectWorkspaceArrival: () => {} }))
vi.mock('electron', () => ({
  app: { on: vi.fn() },
  ipcMain: {
    handle: (name: string, handler: (...args: unknown[]) => unknown) =>
      mocks.handlers.set(name, handler)
  }
}))
vi.mock('../../persistence', () => ({
  Store: class {
    getRepos(): unknown[] {
      return [{}, {}]
    }
  }
}))
vi.mock('../../orca-profiles/profile-persistence-deadline', () => ({
  flushActiveProfileBeforeRelaunch: mocks.flush
}))
vi.mock('../../app-relaunch', () => ({
  runBeforeRelaunchCleanup: async () => {}
}))
vi.mock('../../startup/process-quit-request', () => ({ quitProcess: mocks.quit }))
const roots: string[] = []
afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
  mocks.handlers.clear()
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

it('refuses stale sources and failed checkpoints without changing selection, then relaunches to the validated destination', async () => {
  vi.useFakeTimers()
  const root = mkdtempSync(join(tmpdir(), 'bastion-switch-'))
  roots.push(root)
  const catalog = new WorkspaceCatalog(root)
  try {
    const a = catalog.create('A'),
      b = catalog.create('B')
    configureProjectWorkspace(root, () => {}, [`--bastion-project-workspace=${a.id}`], {})
    registerProjectWorkspaceHandlers(new Store())
    const switchWorkspace = mocks.handlers.get('bastionWorkspaces:switch')
    if (!switchWorkspace) {
      throw new Error('Missing switch handler')
    }
    const sender = { isDestroyed: () => false, send: vi.fn() }
    await expect(switchWorkspace({ sender }, { fromId: 'existing', toId: b.id })).rejects.toThrow(
      /context changed/
    )
    expect(mocks.flush).not.toHaveBeenCalled()
    mocks.flush.mockRejectedValueOnce(new Error('disk full'))
    await expect(switchWorkspace({ sender }, { fromId: a.id, toId: b.id })).rejects.toThrow(
      'disk full'
    )
    expect(catalog.selected().id).toBe(a.id)
    expect(mocks.destination).not.toHaveBeenCalled()
    mocks.flush.mockResolvedValueOnce(undefined)
    mocks.destination.mockRejectedValueOnce(new Error('Destination unavailable'))
    await expect(switchWorkspace({ sender }, { fromId: a.id, toId: b.id })).rejects.toThrow(
      'Destination unavailable'
    )
    expect(catalog.selected().id).toBe(a.id)
    expect(mocks.quit).not.toHaveBeenCalled()
    mocks.destination.mockClear()
    await expect(switchWorkspace({ sender }, { fromId: a.id, toId: b.id })).resolves.toEqual({
      status: 'relaunching'
    })
    expect(catalog.selected().id).toBe(b.id)
    expect(sender.send).toHaveBeenCalledWith('app:restart-committed')
    await vi.advanceTimersByTimeAsync(150)
    expect(mocks.destination).toHaveBeenCalledWith(sender, b.id)
    expect(mocks.quit).toHaveBeenCalledOnce()
    const list = mocks.handlers.get('bastionWorkspaces:list')
    expect(list?.()).toMatchObject({ activeId: a.id })
    expect(catalog.get(a.id).repoCount).toBe(2)
    expect(() => mocks.handlers.get('bastionWorkspaces:create')?.({}, { name: 'Nested' })).toThrow(
      /application home/
    )
  } finally {
    catalog.close()
  }
})

it('leaves a workspace for application home and creates new workspaces only there', async () => {
  vi.useFakeTimers()
  const root = mkdtempSync(join(tmpdir(), 'bastion-leave-'))
  roots.push(root)
  const catalog = new WorkspaceCatalog(root)
  try {
    const a = catalog.create('A')
    configureProjectWorkspace(root, () => {}, [`--bastion-project-workspace=${a.id}`], {})
    registerProjectWorkspaceHandlers(new Store())
    const sender = { isDestroyed: () => false, send: vi.fn() }
    await expect(
      mocks.handlers.get('bastionWorkspaces:switch')?.({ sender }, { fromId: a.id, toId: 'home' })
    ).resolves.toEqual({ status: 'relaunching' })
    expect(catalog.atHome()).toBe(true)
    await vi.advanceTimersByTimeAsync(150)
    expect(mocks.destination).toHaveBeenCalledWith(sender, 'home')
    mocks.handlers.clear()
    configureProjectWorkspace(root, () => {}, [], {})
    registerProjectWorkspaceHandlers(new Store())
    const created = mocks.handlers.get('bastionWorkspaces:create')?.({}, { name: 'B' })
    expect(created).toMatchObject({ activeId: 'home' })
  } finally {
    catalog.close()
  }
})
