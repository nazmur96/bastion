import { callRuntimeRpc } from '@/runtime/runtime-rpc-client'
import { callRuntimeFileMutationWithCapabilities } from '@/runtime/runtime-file-mutation-rpc'
import { toRuntimeWorktreeSelector } from '@/runtime/runtime-worktree-selector'
import { RuntimeRpcCallError } from '@/runtime/runtime-rpc-result'
import {
  ownerRunReceiptSchema,
  sameChangeScope,
  sameChangeTarget,
  type ChangeRecord,
  type ChangeSnapshot
} from '../../../../shared/fork-changes/change-contract'
import type { RuntimeStatus } from '../../../../shared/runtime-types'
import { captureSourceCheckOwner } from './source-check-owner'
import { updateChange } from './change-channel'

type Owner = ReturnType<typeof captureSourceCheckOwner>
export async function pinOwnerSnapshot(
  owner: Owner,
  snapshot: ChangeSnapshot
): Promise<ChangeSnapshot> {
  owner.assertCurrent()
  const status = await callRuntimeRpc<RuntimeStatus>(
    owner.context.target,
    'status.get',
    undefined,
    { beforeSend: owner.assertCurrent, timeoutMs: 15000 }
  )
  owner.assertCurrent()
  return { ...snapshot, ownerRuntimeId: status.runtimeId }
}
function query(owner: Owner, runId: string, runtimeId: string) {
  return {
    worktree: toRuntimeWorktreeSelector(owner.scope.projectId),
    runId,
    expectedRoot: owner.scope.root,
    expectedRuntimeId: runtimeId,
    expectedExecutionHostId: owner.route.expectedExecutionHostId,
    expectedSshTargetId: owner.route.expectedSshTargetId,
    expectedSshConnectionGeneration: owner.route.expectedSshConnectionGeneration
  }
}
async function receipt(owner: Owner, runId: string, runtimeId: string) {
  owner.assertCurrent()
  const result = await callRuntimeRpc<unknown>(
    owner.context.target,
    'changes.get',
    query(owner, runId, runtimeId),
    { beforeSend: owner.assertCurrent, timeoutMs: 15000 }
  )
  owner.assertCurrent()
  return result === null ? null : ownerRunReceiptSchema.parse(result)
}

export async function refreshOwnerRuns(record: ChangeRecord): Promise<ChangeRecord> {
  const owner = captureSourceCheckOwner(record.scope.projectId)
  if (!sameChangeScope(owner.scope, record.scope)) {
    throw new Error('Owner context changed. Reopen the change before refreshing evidence.')
  }
  let current = record
  for (const run of record.runs) {
    if (
      !run.execution ||
      (run.status !== 'running' && run.status !== 'interrupted') ||
      !sameChangeTarget(run.scope ?? record.scope, owner.scope)
    ) {
      continue
    }
    const result = await receipt(owner, run.id, run.execution.runtimeId)
    if (result && (run.status === 'running' || result.status !== 'running')) {
      current = await updateChange(current, { kind: 'reconcile', receipt: result })
    }
  }
  return current
}

export async function executeReviewedOwnerRun(
  record: ChangeRecord,
  owner: Owner,
  snapshot: ChangeSnapshot,
  proposal?: string
): Promise<ChangeRecord> {
  owner.assertCurrent()
  const status = await callRuntimeRpc<RuntimeStatus>(
    owner.context.target,
    'status.get',
    undefined,
    { beforeSend: owner.assertCurrent, timeoutMs: 15000 }
  )
  owner.assertCurrent()
  if (snapshot.ownerRuntimeId !== status.runtimeId) {
    await updateChange(record, { kind: 'invalidate' })
    throw new Error('Execution owner restarted. Prepare and review the current configuration.')
  }
  const review = record.reviews.at(-1)
  if (!review) {
    throw new Error('Review the source plan before execution.')
  }
  let current = await updateChange(record, {
    kind: 'start',
    reviewId: review.id,
    snapshot,
    execution: { runtimeId: status.runtimeId }
  })
  const run = current.runs.at(-1)
  if (!run) {
    throw new Error('Owner run did not start.')
  }
  const params = {
    ...query(owner, run.id, status.runtimeId),
    snapshot,
    ...(proposal === undefined ? {} : { proposal })
  }
  try {
    const result =
      owner.context.target.kind === 'environment'
        ? await callRuntimeFileMutationWithCapabilities<unknown>(
            owner.context.target,
            'changes.execute',
            async () => ({ params }),
            15000,
            undefined,
            owner.assertCurrent
          )
        : await callRuntimeRpc<unknown>(owner.context.target, 'changes.execute', params, {
            beforeSend: owner.assertCurrent
          })
    owner.assertCurrent()
    current = await updateChange(current, {
      kind: 'reconcile',
      receipt: ownerRunReceiptSchema.parse(result)
    })
    while (current.runs.find((item) => item.id === run.id)?.status === 'running') {
      await new Promise<void>((resolve) => setTimeout(resolve, 500))
      const next = await receipt(owner, run.id, status.runtimeId)
      if (!next) {
        throw new Error(
          'The owner has not recorded this attempt. Refresh evidence before retrying.'
        )
      }
      current = await updateChange(current, { kind: 'reconcile', receipt: next })
    }
    return current
  } catch (error) {
    if (error instanceof RuntimeRpcCallError && error.code === 'method_not_found') {
      await updateChange(current, { kind: 'interrupt', runId: run.id })
      throw new Error(
        'This owner needs a newer Orca server for reviewed changes. No fallback execution was attempted.'
      )
    }
    throw new Error(
      'Owner execution could not be confirmed. Refresh run evidence after reconnecting; the original attempt may still be running.'
    )
  }
}
