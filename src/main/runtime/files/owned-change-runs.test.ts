import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RuntimeStore } from '../runtime-store-contract'
import type * as OwnerExecutor from '../../fork/changes/owner-run-executor'
import { getDiskBaselineSignature } from '../../../shared/disk-baseline-signature'
import { ChangeLedger } from '../../fork/changes/change-ledger'
import type { ExecutionHostId } from '../../../shared/execution-host'

const m = vi.hoisted(
  (): { profile: string; block: boolean; release: () => void; executions: number } => ({
    profile: '',
    block: false,
    release: () => {},
    executions: 0
  })
)
vi.mock('../../orca-profiles/profile-storage-paths', () => ({
  getProfileUserDataPath: () => m.profile
}))
vi.mock('./chat-scratch-file-root', () => ({
  resolveRuntimeAuthorizedPath: (path: string) => realpath(path)
}))
vi.mock('../../fork/changes/owner-run-executor', async (original) => {
  const real = await original<typeof OwnerExecutor>()
  return {
    executeOwnerRun: async (...args: Parameters<typeof real.executeOwnerRun>) => {
      m.executions++
      if (m.block) {
        await new Promise<void>((resolve) => {
          m.release = resolve
        })
      }
      return real.executeOwnerRun(...args)
    }
  }
})
import { RuntimeOwnedChangeRuns } from './owned-change-runs'
let root: string
const owners: RuntimeOwnedChangeRuns[] = []
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'bastion-owned-work-'))
  m.profile = mkdtempSync(join(tmpdir(), 'bastion-owner-profile-'))
  m.block = false
  m.executions = 0
  writeFileSync(join(root, 'a.json'), '{}')
})
afterEach(async () => {
  m.release()
  for (const owner of owners.splice(0)) {
    await owner.close()
  }
  rmSync(root, { recursive: true, force: true })
  rmSync(m.profile, { recursive: true, force: true })
})
function owner(hostId: ExecutionHostId = 'local') {
  const value = new RuntimeOwnedChangeRuns({
    getRuntimeId: () => 'runtime-one',
    requireStore: vi.fn<() => RuntimeStore>(),
    resolveRuntimeFileTarget: async () => ({
      worktree: { id: 'fixture', path: root },
      executionHostId: hostId
    })
  })
  owners.push(value)
  return value
}
function request() {
  return {
    worktree: 'id:fixture',
    runId: randomUUID(),
    expectedRoot: root,
    expectedRuntimeId: 'runtime-one',
    expectedExecutionHostId: 'local',
    snapshot: {
      adapter: 'source-check/v1' as const,
      ownerRuntimeId: 'runtime-one',
      files: [{ path: 'a.json', fingerprint: getDiskBaselineSignature('{}') }]
    }
  }
}

function query(params: ReturnType<typeof request>) {
  const { worktree, runId, expectedRoot, expectedRuntimeId, expectedExecutionHostId } = params
  return { worktree, runId, expectedRoot, expectedRuntimeId, expectedExecutionHostId }
}
describe('runtime-owned change execution', () => {
  it('returns before completion, survives a replacement client, and admits a run only once', async () => {
    m.block = true
    const server = owner(),
      replacementClient = owner(),
      params = request()
    const admitted = await server.execute(params)
    expect(admitted.status).toBe('running')
    expect((await replacementClient.get(query(params)))?.status).toBe('running')
    expect((await replacementClient.execute(params)).id).toBe(admitted.id)
    expect(m.executions).toBe(1)
    m.release()
    await vi.waitFor(
      async () => expect((await replacementClient.get(query(params)))?.status).toBe('passed'),
      { timeout: 5000 }
    )
    expect((await replacementClient.get(query(params)))?.verification?.code).toBe('unchanged')
  })
  it('refuses stale roots, runtime identities, SSH ownership and mismatched proposals before execution', async () => {
    const params = request(),
      server = owner()
    await expect(server.execute({ ...params, expectedRoot: '/different' })).rejects.toThrow(
      'root changed'
    )
    await expect(server.execute({ ...params, expectedRuntimeId: 'replaced' })).rejects.toThrow(
      'restarted'
    )
    await expect(owner('ssh:elsewhere').execute(params)).rejects.toThrow()
    await expect(
      server.execute({
        ...params,
        snapshot: { ...params.snapshot, adapter: 'create-file/v1' },
        proposal: '{"different":true}'
      })
    ).rejects.toThrow('Proposal')
    expect(m.executions).toBe(0)
  })
  it('recovers a prior runtime receipt as interrupted without losing its checkpoint', async () => {
    const params = request()
    const ledger = new ChangeLedger(join(m.profile, 'change-owner'))
    ledger.admitReceipt({
      id: params.runId,
      runtimeId: 'previous-runtime',
      ownerPid: process.pid,
      root,
      worktreeId: 'fixture',
      snapshot: { ...params.snapshot, ownerRuntimeId: 'previous-runtime' },
      at: 1,
      steps: [{ path: 'a.json', code: 'json-valid', at: 2 }],
      status: 'running',
      finishedAt: null,
      verification: null
    })
    ledger.close()
    const recovered = await owner().get({ ...query(params), expectedRuntimeId: 'previous-runtime' })
    expect(recovered).toMatchObject({
      status: 'interrupted',
      steps: [{ path: 'a.json', code: 'json-valid' }],
      verification: null
    })
  })
})
