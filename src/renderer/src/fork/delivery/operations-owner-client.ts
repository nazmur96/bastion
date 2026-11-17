import { callRuntimeRpc } from '@/runtime/runtime-rpc-client'
import { toRuntimeWorktreeSelector } from '@/runtime/runtime-worktree-selector'
import type { RemoteCloudOperation } from '../../../../shared/fork-cloud/cloud-operation-contract'
import type { DeliveryResult } from '../../../../shared/fork-delivery/delivery-contract'
import type { RuntimeStatus } from '../../../../shared/runtime-types'
import { captureSourceCheckOwner } from '../changes/source-check-owner'
import { startWorkspaceHost } from '../workbench/start-project-actions'

/**
 * Fork: a delivery operation runs on the project's owner. A local project keeps the desktop
 * IPC path; a remote (SSH) project's managed runtime runs it with that host's own tools and
 * credentials, and nothing is read on this computer on its behalf.
 */
export async function ownerOperation<T extends object>(
  projectId: string,
  operation: RemoteCloudOperation,
  request: unknown,
  local: () => Promise<DeliveryResult<T> | undefined>
): Promise<DeliveryResult<T> | undefined> {
  if (startWorkspaceHost(projectId) === 'local') {
    return local()
  }
  try {
    const owner = captureSourceCheckOwner(projectId)
    const send = { beforeSend: owner.assertCurrent, timeoutMs: 15000 }
    const status = await callRuntimeRpc<RuntimeStatus>(
      owner.context.target,
      'status.get',
      undefined,
      send
    )
    const result = await callRuntimeRpc<T>(
      owner.context.target,
      'cloud.operation',
      {
        worktree: toRuntimeWorktreeSelector(projectId),
        expectedRoot: owner.scope.root,
        expectedRuntimeId: status.runtimeId,
        expectedExecutionHostId: owner.route.expectedExecutionHostId,
        expectedSshTargetId: owner.route.expectedSshTargetId,
        expectedSshConnectionGeneration: owner.route.expectedSshConnectionGeneration,
        operation,
        request
      },
      { ...send, timeoutMs: 120000 }
    )
    owner.assertCurrent()
    return { ok: true, ...result }
  } catch (error) {
    return {
      ok: false,
      code: 'owner',
      message: `The project owner could not run this: ${error instanceof Error ? error.message : 'unknown error'}`
    }
  }
}
