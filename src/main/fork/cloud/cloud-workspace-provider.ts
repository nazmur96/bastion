import { createHash } from 'node:crypto'
import type { Store } from '../../persistence'
import type { ChangeScope, ChangeSnapshot } from '../../../shared/fork-changes/change-contract'
import type { BoundCloud } from '../../../shared/fork-cloud/cloud-binding'
import { FlociFailure, type FlociAction } from '../../../shared/fork-cloud/floci-contract'
import { ChangeLedger } from '../changes/change-ledger'
import {
  cloudProjectRegistration,
  resolveCloudProjectOwner,
  type CloudProjectRuntime
} from './cloud-target-owner'
import { FlociController } from './floci-controller'
import { captureCatalogBinding, cloudSnapshotHash } from './cloud-binding-authority'
import type { CloudTargetCatalog } from './cloud-target-catalog'

type OwnerStore = Pick<Store, 'getRepos' | 'getFolderWorkspaces' | 'getProjectGroups'>
export class CloudWorkspaceProvider {
  readonly ledger: ChangeLedger
  readonly controller: FlociController
  constructor(
    readonly root: string,
    readonly namespaceId: string,
    readonly catalog: CloudTargetCatalog,
    private readonly store: OwnerStore,
    private readonly runtime: CloudProjectRuntime,
    notify: () => void
  ) {
    this.ledger = new ChangeLedger(root)
    this.controller = new FlociController(root, namespaceId, catalog, this.ledger, notify)
  }
  async owner(projectId: string) {
    const registration = cloudProjectRegistration(this.store, projectId)
    const owner = await resolveCloudProjectOwner(this.store, this.runtime, projectId)
    if (!owner || !registration.local) {
      throw new FlociFailure('owner-changed')
    }
    const assertOwner = () => {
      const current = cloudProjectRegistration(this.store, projectId)
      if (!current.local || current.stamp !== registration.stamp) {
        throw new FlociFailure('owner-changed')
      }
    }
    assertOwner()
    return { owner, registration, assertOwner }
  }
  async selected(projectId: string, targetId: string) {
    const context = await this.owner(projectId)
    const selection = this.catalog.snapshot(projectId).selection
    const assertAdmission = () => {
      context.assertOwner()
      const current = this.catalog.snapshot(projectId).selection
      if (
        !selection ||
        selection.targetId !== targetId ||
        selection.owner.root !== context.owner.root ||
        current?.generation !== selection.generation ||
        current.targetId !== targetId
      ) {
        throw new FlociFailure('owner-changed')
      }
    }
    assertAdmission()
    return { ...context, assertAdmission }
  }
  async capture(scope: ChangeScope) {
    const { owner, registration, assertOwner } = await this.owner(scope.projectId)
    if (scope.hostId !== 'local' || scope.root !== owner.root) {
      throw new FlociFailure('owner-changed')
    }
    const runtimeId = this.runtime.getRuntimeId?.()
    if (!runtimeId) {
      throw new FlociFailure('owner-changed')
    }
    const authoritativeScope = {
      ...scope,
      routeKey: createHash('sha256').update(registration.stamp).digest('hex')
    }
    const current = () => {
      assertOwner()
      if (this.runtime.getRuntimeId?.() !== runtimeId) {
        throw new FlociFailure('owner-changed')
      }
      return captureCatalogBinding(
        this.catalog,
        this.namespaceId,
        authoritativeScope,
        runtimeId,
        registration.stamp
      )
    }
    return { binding: current(), current, catalog: this.catalog }
  }
  claim(
    runId: string,
    snapshot: ChangeSnapshot,
    scope: { projectId: string; root: string; runtimeId: string }
  ): () => void {
    const binding = snapshot.cloudBinding
    if (
      binding?.kind !== 'emulated-aws' ||
      binding.namespaceId !== this.namespaceId ||
      binding.projectId !== scope.projectId ||
      binding.owner.root !== scope.root ||
      binding.owner.runtimeId !== scope.runtimeId
    ) {
      throw new FlociFailure('owner-changed')
    }
    // An admitted run remains pinned when another target is selected.
    this.catalog.instances.claimSource(runId, binding, cloudSnapshotHash(snapshot))
    return () => this.catalog.instances.releaseSource(runId)
  }
  async captureProject(projectId: string): Promise<BoundCloud> {
    const { owner } = await this.owner(projectId)
    const selection = this.catalog.snapshot(projectId).selection
    if (!selection?.targetId) {
      throw new FlociFailure('invalid')
    }
    await this.controller.ensure(selection.targetId)
    return (await this.capture({ projectId, ...owner, routeKey: 'local' })).binding
  }
  async act(action: FlociAction) {
    const { assertOwner, assertAdmission } = await this.selected(action.projectId, action.targetId)
    return this.controller.act(action, assertOwner, assertAdmission)
  }
  close(): void {
    this.controller.close()
    this.ledger.close()
  }
}
