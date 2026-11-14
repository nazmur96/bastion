import { createBrowserUuid } from '@/lib/browser-uuid'
import type {
  CloudConnectionsSnapshot,
  CloudTargetsApi
} from '../../../../shared/fork-cloud/cloud-target-contract'
import type {
  RealAwsIdentity,
  RealAwsResources,
  RealAwsBudgets,
  RealAwsCode
} from '../../../../shared/fork-cloud/real-aws-contract'
export type RealCloudState = {
  identity: RealAwsIdentity | null
  resources?: RealAwsResources
  budgets?: RealAwsBudgets
  error: string | null
  code?: RealAwsCode
}
export type RealCloudAction = 'verify' | 'accept' | 'resources' | 'budgets'
export function sameRealSelection(
  a: CloudConnectionsSnapshot | null,
  b: CloudConnectionsSnapshot
): boolean {
  const target = a?.targets.find((target) => target.id === a.selection?.targetId),
    selected = b.targets.find((target) => target.id === b.selection?.targetId)
  return Boolean(
    a &&
    a.namespaceId === b.namespaceId &&
    a.projectId === b.projectId &&
    a.owner === b.owner &&
    a.selection?.generation === b.selection?.generation &&
    target?.id === selected?.id &&
    target?.configRevision === selected?.configRevision
  )
}
export async function performRealCloudAction(
  api: CloudTargetsApi,
  snapshot: CloudConnectionsSnapshot,
  previous: RealCloudState | null | undefined,
  operation: RealCloudAction
) {
  const targetId = snapshot.selection?.targetId
  if (!targetId) {
    throw new Error('Select a real AWS target.')
  }
  const args = { projectId: snapshot.projectId, targetId }
  const result =
    operation === 'verify'
      ? await api.verifyRealTarget?.(args)
      : operation === 'accept' && previous?.identity
        ? await api.acceptRealIdentity?.({
            ...args,
            observationId: previous.identity.observationId,
            revision: snapshot.revision
          })
        : operation === 'resources' || operation === 'budgets'
          ? await api.readRealTarget?.({ ...args, operation, requestId: createBrowserUuid() })
          : undefined
  if (!result?.ok) {
    return {
      snapshot,
      real: {
        identity: null,
        error: result?.message ?? 'Real AWS is unavailable in this client.',
        ...(result && !result.ok ? { code: result.code } : {})
      }
    }
  }
  const refreshed = await api.read(snapshot.projectId)
  if (!refreshed.ok) {
    throw new Error('Target metadata is unavailable. Verify again.')
  }
  const expected =
    operation === 'accept'
      ? {
          ...snapshot,
          targets: snapshot.targets.map((target) =>
            target.id === targetId
              ? { ...target, configRevision: target.configRevision + 1 }
              : target
          )
        }
      : snapshot
  if (!sameRealSelection(expected, refreshed.snapshot)) {
    throw new Error('The selected target changed. Verify again.')
  }
  const value = result.value
  const identity = 'identity' in value ? value.identity : value
  const real: RealCloudState = { ...previous, identity, error: null }
  if ('data' in value) {
    if ('results' in value.data) {
      real.resources = value.data
    } else {
      real.budgets = value.data
    }
  }
  return { snapshot: refreshed.snapshot, real }
}
