import { realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { getDiskBaselineSignature } from '../../../shared/disk-baseline-signature'
import type { OwnerRunReceipt } from '../../../shared/fork-changes/change-contract'
import {
  OwnerRunExecute,
  OwnerRunGet,
  isRootSourceFilename,
  type OwnerRunQuery,
  type OwnerRunRequest
} from '../../../shared/fork-changes/owner-run-contract'
import { getProfileUserDataPath } from '../../orca-profiles/profile-storage-paths'
import { inspectProcessLiveness } from '../../daemon/daemon-process-inspection'
import { ChangeLedger } from '../../fork/changes/change-ledger'
import { executeOwnerRun } from '../../fork/changes/owner-run-executor'
import { assertRuntimeFileMutationExpectation } from './file-mutation-expectation'
import { requireLocalRuntimeFileRoute } from './file-target'
import { resolveRuntimeAuthorizedPath } from './chat-scratch-file-root'
import type { RuntimeFileCommandHost } from './file-command-host'
import type { ExecutionHostId } from '../../../shared/execution-host'

type OwnerHost = Pick<RuntimeFileCommandHost, 'getRuntimeId' | 'requireStore'> & {
  resolveRuntimeFileTarget(
    selector: string
  ): Promise<{ worktree: { id: string; path: string }; executionHostId: ExecutionHostId }>
}

const jobs = new Map<string, Promise<void>>()
export class RuntimeOwnedChangeRuns {
  private ledger: ChangeLedger | undefined
  constructor(private readonly host: OwnerHost) {}
  async close(): Promise<void> {
    await Promise.allSettled(jobs.values())
    this.ledger?.close()
    this.ledger = undefined
  }
  private storage(): ChangeLedger {
    this.ledger ??= new ChangeLedger(join(getProfileUserDataPath(), 'change-owner'))
    return this.ledger
  }
  private async target(params: OwnerRunQuery) {
    const target = await this.host.resolveRuntimeFileTarget(params.worktree)
    requireLocalRuntimeFileRoute(target)
    assertRuntimeFileMutationExpectation(
      target.executionHostId,
      params.expectedExecutionHostId,
      params.expectedSshTargetId,
      params.expectedSshConnectionGeneration
    )
    if (target.worktree.path !== params.expectedRoot) {
      throw new Error('Project root changed; prepare and review again.')
    }
    const root = await realpath(
      await resolveRuntimeAuthorizedPath(target.worktree.path, this.host.requireStore())
    )
    return { target, root }
  }
  async get(raw: OwnerRunQuery): Promise<OwnerRunReceipt | null> {
    const params = OwnerRunGet.parse(raw)
    const { target } = await this.target(params)
    const receipt = this.storage().receipt(params.runId)
    if (!receipt) {
      return null
    }
    if (
      receipt.root !== params.expectedRoot ||
      receipt.worktreeId !== target.worktree.id ||
      receipt.runtimeId !== params.expectedRuntimeId
    ) {
      throw new Error('Receipt belongs to another owner or project.')
    }
    if (
      receipt.status === 'running' &&
      !jobs.has(receipt.id) &&
      (receipt.ownerPid === process.pid ||
        inspectProcessLiveness(receipt.ownerPid).status === 'exited')
    ) {
      receipt.status = 'interrupted'
      receipt.finishedAt = Date.now()
      this.storage().saveReceipt(receipt)
    }
    return receipt
  }
  async execute(raw: OwnerRunRequest): Promise<OwnerRunReceipt> {
    const params = OwnerRunExecute.parse(raw)
    const { target, root } = await this.target(params)
    if (
      params.expectedRuntimeId !== this.host.getRuntimeId() ||
      params.snapshot.ownerRuntimeId !== params.expectedRuntimeId
    ) {
      throw new Error('Execution owner restarted; review against the current owner.')
    }
    if (params.snapshot.adapter === 'create-file/v1') {
      const source = params.snapshot.files[0]
      if (
        params.snapshot.files.length !== 1 ||
        !isRootSourceFilename(source.path) ||
        params.proposal === undefined ||
        getDiskBaselineSignature(params.proposal) !== source.fingerprint
      ) {
        throw new Error('Proposal does not match the reviewed source plan.')
      }
    } else if (params.proposal !== undefined) {
      throw new Error('Source checks do not accept proposal content.')
    }
    const receipt: OwnerRunReceipt = {
      id: params.runId,
      runtimeId: params.expectedRuntimeId,
      ownerPid: process.pid,
      worktreeId: target.worktree.id,
      root: params.expectedRoot,
      snapshot: params.snapshot,
      at: Date.now(),
      steps: [],
      status: 'running',
      finishedAt: null,
      verification: null
    }
    const store = this.storage()
    const admitted = store.admitReceipt(receipt)
    if (!admitted.created) {
      return admitted.receipt
    }
    if (jobs.size >= 4) {
      receipt.status = 'interrupted'
      receipt.finishedAt = Date.now()
      store.saveReceipt(receipt)
      return receipt
    }
    const job = executeOwnerRun(receipt, root, params.proposal, (next) => store.saveReceipt(next))
      .catch(() => {
        try {
          const previous = store.receipt(receipt.id)
          if (previous?.status === 'running') {
            previous.status = 'interrupted'
            previous.finishedAt = Date.now()
            store.saveReceipt(previous)
          }
        } catch {
          console.warn('[changes] Owner receipt could not be persisted; completion is unknown.')
        }
      })
      .finally(() => jobs.delete(receipt.id))
    jobs.set(receipt.id, job)
    return admitted.receipt
  }
}
