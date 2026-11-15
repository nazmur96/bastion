import type { Repo } from '../../../shared/repo-types'
import type * as ResourceModule from './floci-resources'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FlociHttp } from './floci-resources'
import { CloudTargetCatalog } from './cloud-target-catalog'
import { CloudWorkspaceProvider } from './cloud-workspace-provider'
const transport = vi.hoisted(() => ({ http: vi.fn<FlociHttp>() }))
vi.mock('./floci-resources', async (importOriginal) => {
  const actual = await importOriginal<typeof ResourceModule>()
  return {
    ...actual,
    listFlociResources: (...args: Parameters<typeof actual.listFlociResources>) =>
      actual.listFlociResources(args[0], transport.http, args[2], args[3])
  }
})
const cleanup: (() => void)[] = []
function fixture(
  namespace = 'workspace-a',
  provider: 'azure' | 'gcp' | 'oci' = 'gcp',
  port = 14888
) {
  const root = mkdtempSync(join(tmpdir(), 'multicloud-owner-'))
  const catalog = new CloudTargetCatalog(root)
  const projectId = `repo::${root}`
  const repo: Repo = {
    id: 'repo',
    path: root,
    displayName: 'Fixture',
    badgeColor: '',
    addedAt: 0,
    executionHostId: 'local'
  }
  const store = {
    getRepos: () => [repo],
    getFolderWorkspaces: () => [],
    getProjectGroups: () => []
  }
  let runtimeId = 'runtime-a'
  const resolve = vi.fn(async () => ({
    executionHostId: 'local',
    worktree: { id: projectId, path: root }
  }))
  const owner = new CloudWorkspaceProvider(
    root,
    namespace,
    catalog,
    store,
    { getRuntimeId: () => runtimeId, resolveRuntimeFileTarget: resolve },
    () => {}
  )
  for (const label of ['A', 'B']) {
    catalog.mutate(catalog.snapshot().revision, {
      kind: 'add',
      label,
      configuration: { kind: 'emulated', provider, emulator: 'floci', runtimeId: 'local' }
    })
  }
  const [targetId, b] = catalog.snapshot().targets.map((t) => t.id)
  const instance = catalog.instances.reserve(namespace, targetId, root, port, 'docker')
  Object.assign(instance, {
    state: 'ready',
    epoch: 1,
    containerId: 'a'.repeat(64),
    imageId: 'sha256:fixture',
    engineId: 'fixture'
  })
  catalog.instances.save(instance)
  catalog.select(catalog.snapshot().revision, projectId, targetId, { hostId: 'local', root })
  const refresh = vi.spyOn(owner.controller, 'refresh').mockImplementation(async (id) => {
    const current = catalog.instances.get(id)
    if (!current) {
      throw new Error('Missing fixture')
    }
    return owner.controller.view(current)
  })
  const f = {
    root,
    catalog,
    projectId,
    targetId,
    b,
    repo,
    owner,
    refresh,
    resolve,
    restart: () => {
      runtimeId = 'runtime-b'
    }
  }
  cleanup.push(() => {
    owner.close()
    catalog.close()
    rmSync(root, { recursive: true, force: true })
  })
  return f
}
afterEach(() => {
  for (const dispose of cleanup.splice(0)) {
    dispose()
  }
  transport.http.mockReset()
})
const empty = (path: string) => ({
  status: 200,
  body: JSON.stringify(path.startsWith('/storage/') ? { items: [] } : { topics: [] })
})
describe('MC-05 owner admission and publication for provider reads', () => {
  it.each(['selection', 'cross-provider', 'runtime', 'port', 'reset', 'close', 'remote'] as const)(
    'discards a delayed listing after %s changes and never follows another page',
    async (change) => {
      const f = fixture()
      let reads = 0
      transport.http.mockImplementation(async (_port, req) => {
        if (++reads === 1) {
          if (change === 'selection' || change === 'cross-provider') {
            let destination = f.b
            if (change === 'cross-provider') {
              f.catalog.mutate(f.catalog.snapshot().revision, {
                kind: 'add',
                label: 'Other provider',
                configuration: {
                  kind: 'emulated',
                  provider: 'azure',
                  emulator: 'floci',
                  runtimeId: 'local'
                }
              })
              destination = f.catalog.snapshot().targets[2].id
            }
            f.catalog.select(f.catalog.snapshot().revision, f.projectId, destination, {
              hostId: 'local',
              root: f.root
            })
            f.catalog.select(f.catalog.snapshot().revision, f.projectId, f.targetId, {
              hostId: 'local',
              root: f.root
            })
          } else if (change === 'runtime') {
            f.restart()
          } else if (change === 'remote') {
            f.repo.executionHostId = 'ssh:other'
          } else if (change === 'close') {
            f.owner.close()
          } else {
            const value = f.catalog.instances.get(f.targetId)
            if (!value) {
              throw new Error('Missing instance')
            }
            if (change === 'port') {
              value.port++
            } else {
              value.epoch++
              value.state = 'resetting'
            }
            f.catalog.instances.save(value)
          }
        }
        return {
          status: 200,
          body: JSON.stringify(
            req.path.startsWith('/storage/')
              ? { items: [], nextPageToken: 'another-page' }
              : { topics: [] }
          )
        }
      })
      await expect(f.owner.listResources(f.projectId, f.targetId)).rejects.toThrow()
      expect(reads).toBeLessThanOrEqual(2)
    }
  )
  it('rejects a failed physical publication inspection instead of trusting a saved ready row', async () => {
    const f = fixture()
    transport.http.mockImplementation(async (_port, req) => empty(req.path))
    f.refresh.mockImplementation(async (id) => {
      const value = f.catalog.instances.get(id)
      if (!value) {
        throw new Error('Missing instance')
      }
      if (f.refresh.mock.calls.length > 1) {
        value.state = 'unknown'
      }
      return f.owner.controller.view(value)
    })
    await expect(f.owner.listResources(f.projectId, f.targetId)).rejects.toThrow('changed')
    expect(f.refresh).toHaveBeenCalledTimes(2)
  })
  it('refuses remote registration before inspection, network or client config and keeps namespace IDs isolated', async () => {
    const a = fixture(),
      b = fixture('workspace-b', 'gcp', 14889)
    transport.http.mockImplementation(async (_port, req) => empty(req.path))
    await expect(a.owner.listResources(a.projectId, b.targetId)).rejects.toThrow()
    expect(transport.http).not.toHaveBeenCalled()
    expect(a.refresh).not.toHaveBeenCalled()
    a.repo.executionHostId = 'ssh:remote'
    a.resolve.mockClear()
    await expect(a.owner.targetEnv(a.projectId, a.targetId)).rejects.toThrow()
    expect(a.resolve).not.toHaveBeenCalled()
    expect(a.refresh).not.toHaveBeenCalled()
    expect(existsSync(join(a.root, 'bastion-cloud', 'control'))).toBe(false)
    const result = await b.owner.listResources(b.projectId, b.targetId)
    expect(result.provider).toBe('gcp')
    expect(transport.http.mock.calls.every((args) => args[0] === 14889)).toBe(true)
  })
  it('fences a runtime change between building and publishing a sealed context', async () => {
    const f = fixture('workspace-a', 'azure')
    f.refresh.mockImplementation(async (id) => {
      const current = f.catalog.instances.get(id)
      if (!current) {
        throw new Error('Missing instance')
      }
      if (f.refresh.mock.calls.length === 2) {
        f.restart()
      }
      return f.owner.controller.view(current)
    })
    await expect(f.owner.targetEnv(f.projectId, f.targetId)).rejects.toThrow('changed')
  })
  it('does not expose OCI SDK empty config as a usable terminal operation', async () => {
    const f = fixture('workspace-a', 'oci')
    await expect(f.owner.targetEnv(f.projectId, f.targetId)).rejects.toThrow('does not support')
    expect(f.refresh).not.toHaveBeenCalled()
    expect(existsSync(join(f.root, 'bastion-cloud', 'control'))).toBe(false)
  })
})
