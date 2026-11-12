import { beforeEach, describe, expect, it, vi } from 'vitest'

const listRuntimeFiles = vi.fn()
const readRuntimeFileRange = vi.fn()
const assertCurrent = vi.fn()
const route: { target: { kind: string; environmentId?: string } } = {
  target: { kind: 'environment', environmentId: 'env-1' }
}
let connectionId: string | undefined

vi.mock('@/runtime/runtime-file-search-client', () => ({ listRuntimeFiles }))
vi.mock('@/runtime/runtime-file-range-client', () => ({ readRuntimeFileRange }))
vi.mock('../environments/workspace-environment-files', () => ({
  captureProjectFileRoute: () => ({
    root: '/srv/app',
    guard: { route, assertCurrent },
    context: { ...route, connectionId, worktreeId: 'wt', worktreePath: '/srv/app' }
  })
}))

const { readRuntimeDevopsStacks } = await import('./runtime-devops-stacks')

beforeEach(() => {
  vi.clearAllMocks()
  connectionId = undefined
})

describe('readRuntimeDevopsStacks', () => {
  it('detects stacks from the owner’s listing and reads heads through the same route', async () => {
    listRuntimeFiles.mockResolvedValue(['infra/main.tf', 'Chart.yaml', 'mise.toml'])
    readRuntimeFileRange.mockResolvedValue(new TextEncoder().encode('provider "aws" {}'))
    const result = await readRuntimeDevopsStacks('wt')
    expect(result.usesMise).toBe(true)
    expect(result.findings.map((finding) => finding.stack)).toEqual(
      expect.arrayContaining(['terraform', 'aws', 'helm'])
    )
    expect(readRuntimeFileRange).toHaveBeenCalledWith(
      expect.objectContaining({ ...route, relativePath: 'infra/main.tf', worktreeId: 'wt' }),
      0,
      4096
    )
    expect(assertCurrent).toHaveBeenCalledTimes(2)
  })

  it('drops the result when the owner changed while reading', async () => {
    listRuntimeFiles.mockResolvedValue(['main.tf'])
    assertCurrent.mockImplementationOnce(() => {
      throw new Error('owner changed')
    })
    await expect(readRuntimeDevopsStacks('wt')).rejects.toThrow('owner changed')
    expect(readRuntimeFileRange).not.toHaveBeenCalled()
  })

  it('refuses a legacy connection that lists nothing instead of reporting no stacks', async () => {
    connectionId = 'legacy-ssh'
    route.target = { kind: 'local' }
    await expect(readRuntimeDevopsStacks('wt')).rejects.toThrow('not available')
    expect(listRuntimeFiles).not.toHaveBeenCalled()
    route.target = { kind: 'environment', environmentId: 'env-1' }
  })
})
