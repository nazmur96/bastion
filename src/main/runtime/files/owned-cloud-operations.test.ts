import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({ profile: '' }))
vi.mock('../../orca-profiles/profile-storage-paths', () => ({
  getProfileUserDataPath: () => m.profile
}))
vi.mock('./chat-scratch-file-root', () => ({
  resolveRuntimeAuthorizedPath: async (path: string) => path
}))

const { RuntimeOwnedCloudOperations } = await import('./owned-cloud-operations')

const roots: string[] = []
function temporary(): string {
  const root = mkdtempSync(join(tmpdir(), 'bastion-owned-cloud-'))
  roots.push(root)
  return root
}
afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

function operations(root: string) {
  return new RuntimeOwnedCloudOperations({
    getRuntimeId: () => 'runtime-1',
    requireStore: vi.fn(),
    resolveRuntimeFileTarget: async () => ({
      worktree: { id: 'owner-worktree', path: root },
      executionHostId: 'local'
    })
  })
}
const call = (root: string, operation: string, request: unknown, runtimeId = 'runtime-1') => ({
  worktree: `path:${root}`,
  expectedRoot: root,
  expectedRuntimeId: runtimeId,
  expectedExecutionHostId: 'local',
  operation,
  request
})

describe('cloud operations on the project owner', () => {
  it('admits only stateless operations; source writes and local-state cloud reads are refused', async () => {
    const root = temporary()
    for (const operation of [
      'delivery.promote',
      'runbooks.create',
      'floci.start',
      'aws.cost.read'
    ]) {
      await expect(operations(root).run(call(root, operation, {}))).rejects.toThrow()
    }
  })
  it('refuses a restarted owner or a moved project root before running anything', async () => {
    const root = temporary()
    await expect(
      operations(root).run(call(root, 'operations.runs', { projectId: 'p' }, 'runtime-0'))
    ).rejects.toThrow(/restarted/)
    await expect(
      operations(root).run({
        ...call(root, 'operations.runs', { projectId: 'p' }),
        expectedRoot: '/elsewhere'
      })
    ).rejects.toThrow(/root changed/)
  })
  it('requires log reads to be requested as the sensitive operation', async () => {
    const root = temporary()
    const request = {
      projectId: 'p',
      repository: 'example/app',
      workflow: 'build.yml',
      configPath: 'deploy/kustomization.yaml',
      imageName: 'app',
      application: 'app',
      applicationNamespace: 'argocd',
      revision: null,
      logs: true
    }
    await expect(operations(root).run(call(root, 'operations.diagnose', request))).rejects.toThrow(
      /operations\.logs/
    )
  })
  it("keeps run history on the owner under the owner's own project identity", async () => {
    m.profile = temporary()
    const root = temporary()
    await expect(
      operations(root).run(call(root, 'operations.runs', { projectId: 'desktop-id' }))
    ).resolves.toEqual({ runs: [] })
  })
})
