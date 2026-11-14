import { FLOCI_NETWORK_POLICY } from './floci-network-policy'
import { createHash } from 'node:crypto'
import type {
  ChangeCommand,
  ChangeRecord,
  ChangeScope,
  ChangeSnapshot
} from '../../../shared/fork-changes/change-contract'
import { changeSnapshotSchema } from '../../../shared/fork-changes/change-contract'
import { sameCloudBinding, type BoundCloud } from '../../../shared/fork-cloud/cloud-binding'
import type { CloudTargetCatalog } from './cloud-target-catalog'
import { FLOCI_IMAGE } from '../../../shared/fork-cloud/floci-contract'

export function cloudSnapshotHash(snapshot: ChangeSnapshot): string {
  return createHash('sha256')
    .update(JSON.stringify(changeSnapshotSchema.parse(snapshot)))
    .digest('hex')
}
export function captureCatalogBinding(
  catalog: CloudTargetCatalog,
  namespaceId: string,
  scope: ChangeScope,
  runtimeId: string,
  registrationStamp: string
): BoundCloud {
  const { targets, selection } = catalog.snapshot(scope.projectId)
  const target = targets.find((target) => target.id === selection?.targetId)
  if (
    scope.hostId !== 'local' ||
    selection?.owner.root !== scope.root ||
    target?.configuration.kind !== 'emulated' ||
    target.configuration.provider !== 'aws'
  ) {
    throw new Error('Select a local Floci AWS target before preparing this change.')
  }
  const instance = catalog.instances.get(target.id)
  if (!instance || instance.operationId) {
    throw new Error('The selected instance is unavailable or busy.')
  }
  return {
    kind: 'emulated-aws',
    namespaceId,
    projectId: scope.projectId,
    targetId: target.id,
    selectionGeneration: selection.generation,
    configRevision: target.configRevision,
    policyFingerprint: `sha256:${createHash('sha256')
      .update(
        JSON.stringify([
          FLOCI_IMAGE,
          'loopback-private/v1',
          FLOCI_NETWORK_POLICY,
          target.configuration
        ])
      )
      .digest('hex')}`,
    owner: {
      ...scope,
      hostId: 'local',
      runtimeId,
      pairingRevision: createHash('sha256').update(registrationStamp).digest('hex')
    },
    instance: {
      id: instance.id,
      epoch: instance.epoch,
      engineId: instance.engineId,
      containerId: instance.containerId,
      imageDigest: FLOCI_IMAGE,
      port: instance.port,
      persistenceKey: target.id
    }
  }
}
export type CloudBindingAuthority = {
  capture(
    scope: ChangeScope
  ): Promise<{ binding: BoundCloud; current: () => BoundCloud; catalog: CloudTargetCatalog }>
  claim(
    runId: string,
    snapshot: ChangeSnapshot,
    scope: { projectId: string; root: string; runtimeId: string }
  ): () => void
}
let authority: CloudBindingAuthority | undefined
export function setCloudBindingAuthority(value: CloudBindingAuthority | undefined): void {
  authority = value
}
export function requireCloudBindingAuthority(): CloudBindingAuthority {
  if (!authority) {
    throw new Error('Cloud-bound execution is unavailable on this owner.')
  }
  return authority
}
export async function admitCloudChange<T extends ChangeRecord>(
  record: ChangeRecord,
  command: ChangeCommand,
  apply: () => T,
  invalidate: () => void
): Promise<T> {
  if (
    record.intent?.targetMode === 'selected-cloud' &&
    (command.kind === 'step' || command.kind === 'finish')
  ) {
    throw new Error('Cloud-bound runs require owner evidence.')
  }
  if (!('snapshot' in command)) {
    return apply()
  }
  const binding = command.snapshot.cloudBinding
  if (record.intent?.targetMode !== 'selected-cloud') {
    if (binding?.kind === 'emulated-aws') {
      throw new Error('This source change has no cloud target intent.')
    }
    return apply()
  }
  if (binding?.kind !== 'emulated-aws') {
    throw new Error('Cloud-bound changes require a current target binding.')
  }
  const captured = await requireCloudBindingAuthority().capture(record.scope)
  if (
    !sameCloudBinding(binding, captured.binding) ||
    command.snapshot.ownerRuntimeId !== captured.binding.owner.runtimeId
  ) {
    invalidate()
    throw new Error('Cloud target changed. Prepare and review again.')
  }
  if (command.kind !== 'start') {
    return apply()
  }
  if (command.execution?.runtimeId !== captured.binding.owner.runtimeId) {
    throw new Error('Cloud-bound execution requires the admitted owner runtime.')
  }
  return captured.catalog.instances.admitSource(
    binding,
    captured.current,
    cloudSnapshotHash(command.snapshot),
    () => {
      const value = apply(),
        run = value.runs.at(-1)
      if (!run) {
        throw new Error('Cloud run admission failed.')
      }
      return { value, runId: run.id }
    }
  )
}
