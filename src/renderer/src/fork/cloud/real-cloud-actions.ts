import { createBrowserUuid } from '@/lib/browser-uuid'
import type {
  CloudConnectionsSnapshot,
  CloudTargetsApi
} from '../../../../shared/fork-cloud/cloud-target-contract'
import type {
  RealAwsIdentity,
  RealAwsResources,
  RealAwsBackups,
  RealAwsBudgets,
  RealAwsCode,
  RealAwsCostChallenge,
  RealAwsCostView
} from '../../../../shared/fork-cloud/real-aws-contract'
export type RealCloudState = {
  identity: RealAwsIdentity | null
  resources?: RealAwsResources
  budgets?: RealAwsBudgets
  backups?: RealAwsBackups
  /** A pending paid-read confirmation; cancelled by dropping it, never sent. */
  challenge?: RealAwsCostChallenge
  cost?: RealAwsCostView
  costError?: string
  error: string | null
  code?: RealAwsCode
}
export type RealCloudAction =
  | 'verify'
  | 'accept'
  | 'resources'
  | 'budgets'
  | 'backups'
  | 'cost-prepare'
  | 'cost-confirm'
  | 'cost-cancel'
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
// A failed paid read keeps the verified identity; the error explains whether it may have been charged.
async function performRealCostAction(
  api: CloudTargetsApi,
  snapshot: CloudConnectionsSnapshot,
  previous: RealCloudState,
  operation: 'cost-prepare' | 'cost-confirm' | 'cost-cancel',
  targetId: string
): Promise<RealCloudState> {
  const args = { projectId: snapshot.projectId, targetId }
  const base: RealCloudState = { ...previous, challenge: undefined, costError: undefined }
  if (operation === 'cost-cancel') {
    return base
  }
  if (operation === 'cost-prepare') {
    const prepared = await api.prepareRealCost?.({ ...args, requestId: createBrowserUuid() })
    return prepared?.ok
      ? { ...base, challenge: prepared.value }
      : { ...base, costError: prepared?.message ?? 'Cost Explorer is unavailable in this client.' }
  }
  const challenge = previous.challenge
  if (!challenge) {
    return base
  }
  const grant = await api.confirmRealCost?.({ ...args, challengeId: challenge.challengeId })
  if (!grant?.ok) {
    return {
      ...base,
      costError: grant?.message ?? 'The confirmation expired. Nothing was charged.'
    }
  }
  const read = await api.readRealCost?.({
    ...args,
    requestId: challenge.requestId,
    grantId: grant.value.grantId
  })
  if (read?.ok) {
    return { ...base, cost: read.value }
  }
  const uncertain = read?.code === 'timeout' || read?.code === 'owner-changed'
  return {
    ...base,
    cost: undefined,
    costError: `${read?.message ?? 'The Cost Explorer read failed.'}${
      uncertain
        ? ' The request may have been charged; it is recorded as unknown and is not retried.'
        : ''
    }`
  }
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
  if (operation === 'cost-prepare' || operation === 'cost-confirm' || operation === 'cost-cancel') {
    const real = await performRealCostAction(
      api,
      snapshot,
      previous ?? { identity: null, error: null },
      operation,
      targetId
    )
    const refreshed = await api.read(snapshot.projectId)
    if (!refreshed.ok || !sameRealSelection(snapshot, refreshed.snapshot)) {
      throw new Error('The selected target changed. Verify again.')
    }
    return { snapshot: refreshed.snapshot, real }
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
        : operation === 'resources' || operation === 'budgets' || operation === 'backups'
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
    } else if ('databases' in value.data) {
      real.backups = value.data
    } else {
      real.budgets = value.data
    }
  }
  return { snapshot: refreshed.snapshot, real }
}
