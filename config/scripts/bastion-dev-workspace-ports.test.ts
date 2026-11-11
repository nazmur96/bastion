import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { resolveDevWorkspacePorts } from './bastion-dev-workspace-ports.mjs'

const mocks = vi.hoisted(() => ({ free: vi.fn(async () => true), next: 15200 }))
vi.mock('./dev-instance-isolation.mjs', () => ({
  isPortFree: mocks.free,
  parsePortValue: (value: string) => Number(value),
  resolveDevInstancePorts: async ({ env }: { env: NodeJS.ProcessEnv }) => ({
    rendererPort: env.ORCA_DEV_RENDERER_PORT ? Number(env.ORCA_DEV_RENDERER_PORT) : mocks.next++,
    cdpPort: 9413,
    forwardedExtras: []
  })
}))
const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
  mocks.free.mockReset().mockResolvedValue(true)
})
it('preserves each namespace origin over switching and a new runner', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bastion-dev-origin-'))
  roots.push(root)
  const args = { repoRoot: '/repo', forwardedArgs: [], profile: { userDataPath: root } }
  const first = await resolveDevWorkspacePorts({
    ...args,
    env: { BASTION_PROJECT_WORKSPACE_LAUNCH: 'workspace-a' }
  })
  const other = await resolveDevWorkspacePorts({
    ...args,
    env: { BASTION_PROJECT_WORKSPACE_LAUNCH: 'workspace-b' }
  })
  const reopened = await resolveDevWorkspacePorts({
    ...args,
    env: { BASTION_PROJECT_WORKSPACE_LAUNCH: 'workspace-a' }
  })
  expect(first.rendererPort).not.toBe(other.rendererPort)
  expect(reopened.rendererPort).toBe(first.rendererPort)
  const file = join(root, 'bastion-project-workspaces', 'dev-renderer-ports.json')
  const before = readFileSync(file, 'utf8')
  mocks.free.mockResolvedValueOnce(false)
  await expect(
    resolveDevWorkspacePorts({ ...args, env: { BASTION_PROJECT_WORKSPACE_LAUNCH: 'workspace-a' } })
  ).rejects.toThrow(/saved origin/)
  expect(readFileSync(file, 'utf8')).toBe(before)
})
