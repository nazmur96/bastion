import { describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({ spawn: vi.fn() }))
vi.mock('node:child_process', async (load) => ({
  ...(await load<Record<string, unknown>>()),
  spawn: m.spawn
}))
vi.mock('./devops-context', () => ({ workspaceEnv: async () => ({}) }))

describe('step runs bound to a cloud target', () => {
  it('refuses before spawning when the selected target cannot be resolved', async () => {
    const { runSteps } = await import('./devops-step-runner')
    const send = vi.fn()
    const sender = { isDestroyed: () => false, send }
    await runSteps(sender, {
      runId: 'run-1',
      workspacePath: '/work/app',
      steps: ['terraform plan'],
      cloudTarget: { projectId: 'p', targetId: '3f2b8c1e-0a1d-4c4e-9a37-1b2c3d4e5f60' }
    })
    expect(m.spawn).not.toHaveBeenCalled()
    expect(send).toHaveBeenCalledWith('aiVault:stepsEvent', {
      runId: 'run-1',
      kind: 'finished',
      ok: false
    })
  })
})
