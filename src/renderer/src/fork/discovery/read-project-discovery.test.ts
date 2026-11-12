import { beforeEach, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => ({
  host: 'runtime:test',
  list: vi.fn(),
  read: vi.fn(),
  stat: vi.fn(),
  dir: vi.fn(),
  stacks: vi.fn(),
  local: vi.fn(),
  guard: vi.fn()
}))
vi.mock('../workbench/start-project-actions', () => ({ startWorkspaceHost: () => m.host }))
vi.mock('../environments/workspace-environment-files', () => ({
  captureProjectFileRoute: () => ({
    root: '/srv/app',
    guard: {
      assertCurrent: m.guard,
      route: {
        target:
          m.host === 'local' ? { kind: 'desktop' } : { kind: 'environment', environmentId: 'test' }
      }
    },
    context: {
      target:
        m.host === 'local' ? { kind: 'desktop' } : { kind: 'environment', environmentId: 'test' },
      worktreeId: 'wt',
      worktreePath: '/srv/app'
    }
  })
}))
vi.mock('@/runtime/runtime-file-search-client', () => ({ listRuntimeFiles: m.list }))
vi.mock('@/runtime/runtime-file-mutation-client', () => ({ readRuntimeDirectory: m.dir }))
vi.mock('@/runtime/runtime-file-range-client', () => ({
  readRuntimeFileRange: m.read,
  statRuntimeReadTarget: m.stat
}))
vi.mock('../devops/runtime-devops-stacks', () => ({ readRuntimeDevopsStacks: m.stacks }))
import { readProjectDiscovery } from './read-project-discovery'
beforeEach(() => {
  vi.resetAllMocks()
  m.host = 'runtime:test'
  vi.stubGlobal('window', { api: { aiVault: { inspectDevops: m.local } } })
  m.list.mockResolvedValue(['Dockerfile', '.env'])
  m.stacks.mockResolvedValue({ findings: [] })
  m.local.mockResolvedValue({ findings: [] })
  m.dir.mockResolvedValue([
    { name: 'Dockerfile', isDirectory: false, isSymlink: false },
    { name: '.env', isDirectory: false, isSymlink: false }
  ])
  const bytes = new TextEncoder().encode('EXPOSE 8080\n')
  m.stat.mockResolvedValue({ size: bytes.length, mtime: 1 })
  m.read.mockResolvedValue(bytes)
})
it('uses the remote owner for source evidence and never invokes local inspection', async () => {
  const result = await readProjectDiscovery('wt')
  expect(m.local).not.toHaveBeenCalled()
  expect(m.stacks).toHaveBeenCalledWith('wt')
  expect(
    m.read.mock.calls.every(
      ([args]) => args.target.kind === 'environment' && args.relativePath === 'Dockerfile'
    )
  ).toBe(true)
  expect(result.snapshot.facts[0].evidence[0].line).toBe(1)
})
it('uses main-process inspection only for a proven local owner', async () => {
  m.host = 'local'
  await readProjectDiscovery('wt')
  expect(m.local).toHaveBeenCalledWith('/srv/app')
  expect(m.stacks).not.toHaveBeenCalled()
})
it('propagates disconnect failures instead of returning empty findings or local data', async () => {
  m.stacks.mockRejectedValue(new Error('Disconnected'))
  await expect(readProjectDiscovery('wt')).rejects.toThrow('Disconnected')
  expect(m.local).not.toHaveBeenCalled()
  expect(m.read).not.toHaveBeenCalled()
})
it('discards late results after an owner change', async () => {
  m.guard.mockImplementation(() => {
    throw new Error('Owner changed')
  })
  await expect(readProjectDiscovery('wt')).rejects.toThrow('Owner changed')
  expect(m.read).not.toHaveBeenCalled()
})
it('does not read through source symlinks', async () => {
  m.dir.mockResolvedValue([{ name: 'Dockerfile', isDirectory: false, isSymlink: true }])
  const result = await readProjectDiscovery('wt')
  expect(result.snapshot.limits).toContain('Not inspected: Dockerfile')
  expect(m.read).not.toHaveBeenCalled()
})

it('links stack findings to whole files rather than an invented line', async () => {
  m.stacks.mockResolvedValue({
    findings: [{ stack: 'containers', evidence: ['Dockerfile'], dirs: ['.'] }]
  })
  const result = await readProjectDiscovery('wt')
  const stack = result.snapshot.facts.find((fact) => fact.id === 'stack:containers')
  expect(stack?.evidence[0].line).toBeNull()
})
