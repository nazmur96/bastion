import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CloudTargetResult } from '../../../shared/fork-cloud/cloud-target-contract'
import { registerCloudTargetHandlers } from './cloud-target-ipc'
const mocks = vi.hoisted(() => {
  const context: {
    activeId: string
    dataRoot: string
    workspace: { id: string } | null
    incognito: boolean
  } = { activeId: 'A', dataRoot: '', workspace: { id: 'A' }, incognito: false }
  return {
    handlers: new Map<string, (event: unknown, args: unknown) => Promise<CloudTargetResult>>(),
    quit: new Set<() => void>(),
    trusted: true,
    context
  }
})
vi.mock('electron', () => ({
  app: { once: (_event: string, cb: () => void) => mocks.quit.add(cb) },
  ipcMain: {
    handle: (
      name: string,
      handler: (event: unknown, args: unknown) => Promise<CloudTargetResult>
    ) => mocks.handlers.set(name, handler)
  }
}))
vi.mock('../../ipc/ui', () => ({ isTrustedUIRenderer: () => mocks.trusted }))
vi.mock('../project-workspaces/workspace-context', () => ({
  readProjectWorkspaceContext: () => mocks.context
}))
const roots: string[] = []
const sender = { mainFrame: {}, isDestroyed: () => false, once: vi.fn(), send: vi.fn() }
const event = { sender, senderFrame: sender.mainFrame }
const store = {
  getRepos: () => [
    { id: 'r', path: '/fixture', addedAt: 0, displayName: 'Fixture', badgeColor: '' }
  ],
  getFolderWorkspaces: () => [],
  getProjectGroups: () => []
}
const runtime = {
  resolveRuntimeFileTarget: vi.fn(async () => ({
    executionHostId: 'local',
    worktree: { id: 'r::/fixture', path: '/fixture' }
  }))
}
async function call(name: 'read' | 'update', args: unknown, source = event) {
  const handler = mocks.handlers.get(`bastionCloud:${name}`)
  if (!handler) {
    throw new Error('Missing handler')
  }
  return handler(source, args)
}
beforeEach(() => {
  const root = mkdtempSync(join(tmpdir(), 'cloud-ipc-'))
  roots.push(root)
  mocks.context = { activeId: 'A', dataRoot: root, workspace: { id: 'A' }, incognito: false }
  mocks.trusted = true
  vi.clearAllMocks()
  registerCloudTargetHandlers(store, runtime)
})
afterEach(() => {
  vi.restoreAllMocks()
  for (const quit of mocks.quit) {
    quit()
  }
  mocks.quit.clear()
  mocks.handlers.clear()
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})
describe('cloud target IPC authority', () => {
  it('refuses Home, Incognito, untrusted senders and child frames before storage or owner resolution', async () => {
    mocks.context.workspace = null
    expect(await call('read', { projectId: 'r::/fixture' })).toMatchObject({
      ok: false,
      code: 'workspace'
    })
    mocks.context.workspace = { id: 'A' }
    mocks.context.incognito = true
    expect(await call('read', { projectId: 'r::/fixture' })).toMatchObject({
      ok: false,
      code: 'workspace'
    })
    mocks.context.incognito = false
    mocks.trusted = false
    expect(await call('read', { projectId: 'r::/fixture' })).toMatchObject({
      ok: false,
      code: 'workspace'
    })
    mocks.trusted = true
    expect(
      await call('read', { projectId: 'r::/fixture' }, { sender, senderFrame: {} })
    ).toMatchObject({ ok: false, code: 'workspace' })
    expect(runtime.resolveRuntimeFileTarget).not.toHaveBeenCalled()
    expect(existsSync(join(mocks.context.dataRoot, 'bastion-cloud'))).toBe(false)
  })
  it('rejects executable/secret fields with safe errors and no storage', async () => {
    for (const extra of [
      { cloud: 'apply' },
      { token: 'PLANTED_SECRET' },
      { workspaceId: 'B' },
      { root: '/other' }
    ]) {
      expect(
        await call('update', { projectId: 'r::/fixture', revision: 0, ...extra })
      ).toMatchObject({ ok: false, code: 'invalid' })
    }
    expect(runtime.resolveRuntimeFileTarget).not.toHaveBeenCalled()
    expect(existsSync(join(mocks.context.dataRoot, 'bastion-cloud'))).toBe(false)
  })
  it('broadcasts committed revisions and rejects stale clients without provider execution', async () => {
    const request = {
      projectId: 'r::/fixture',
      revision: 0,
      mutation: {
        kind: 'add',
        label: 'Fixture',
        configuration: {
          kind: 'real',
          provider: 'aws',
          profileName: 'fixture',
          region: 'us-east-1'
        }
      }
    }
    expect(await call('update', request)).toMatchObject({
      ok: true,
      snapshot: { revision: 1, namespaceId: 'A' }
    })
    expect(sender.send).toHaveBeenCalledWith('bastionCloud:changed')
    expect(await call('update', request)).toMatchObject({ ok: false, code: 'conflict' })
    expect(
      await call('update', {
        projectId: 'r::/fixture',
        revision: 1,
        selection: '00000000-0000-4000-8000-000000000001'
      })
    ).toMatchObject({ ok: false, code: 'unavailable' })
  })
  it('lists workspace metadata for remote owners while refusing local selection without resolution', async () => {
    const remote = { ...store.getRepos()[0], executionHostId: 'runtime:fixture' as const }
    vi.spyOn(store, 'getRepos').mockReturnValue([remote])
    expect(await call('read', { projectId: 'r::/fixture' })).toMatchObject({
      ok: true,
      snapshot: { owner: 'unavailable', targets: [] }
    })
    expect(
      await call('update', { projectId: 'r::/fixture', revision: 0, selection: null })
    ).toMatchObject({ ok: false, code: 'owner' })
    expect(runtime.resolveRuntimeFileTarget).not.toHaveBeenCalled()
  })
})
