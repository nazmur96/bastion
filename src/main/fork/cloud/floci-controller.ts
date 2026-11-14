import { flociEngineIdentity } from './floci-engine-identity'
import { join, dirname } from 'node:path'
import { lstatSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import type { ChangeLedger } from '../changes/change-ledger'
import type { CloudTargetCatalog } from './cloud-target-catalog'
import {
  FLOCI_IMAGE,
  FlociFailure,
  type FlociInstance,
  type FlociReceipt,
  type FlociView,
  type FlociAction
} from '../../../shared/fork-cloud/floci-contract'
import { inspectContainer } from './floci-engine'
import { startFloci, stopFloci } from './floci-lifecycle'
import { availableFlociPort } from './floci-port'
import { inspectProcessLiveness } from '../../daemon/daemon-process-inspection'
import { checkFlociInspection } from './floci-inspection'
import { ownerEngineRunner, privateFlociDirectory } from './floci-paths'
import { flociHealthy } from './floci-health'

export class FlociController {
  private jobs = new Map<string, Promise<void>>()
  private closed = false
  constructor(
    readonly root: string,
    readonly namespaceId: string,
    readonly catalog: CloudTargetCatalog,
    readonly ledger: ChangeLedger,
    private readonly notify: () => void = () => {},
    private readonly runner = ownerEngineRunner
  ) {}
  async ensure(targetId: string): Promise<FlociInstance> {
    const target = this.catalog.snapshot().targets.find((target) => target.id === targetId)
    if (target?.configuration.kind !== 'emulated' || target.configuration.provider !== 'aws') {
      throw new FlociFailure('invalid')
    }
    const existing = this.catalog.instances.get(targetId)
    return (
      existing ??
      this.catalog.instances.reserve(
        this.namespaceId,
        targetId,
        this.root,
        await availableFlociPort(target.configuration.requestedPort),
        target.configuration.engine ?? 'docker'
      )
    )
  }
  view(instance: FlociInstance): FlociView {
    return {
      instance,
      imageDigest: FLOCI_IMAGE,
      receipts: this.ledger.lifecycleReceipts(instance.targetId)
    }
  }
  private save(instance: FlociInstance): void {
    if (this.closed) {
      throw new FlociFailure('interrupted')
    }
    this.catalog.instances.save(instance)
    this.notify()
  }
  private interruptAbandoned(instance: FlociInstance): void {
    if (
      !instance.operationId ||
      !instance.operationPid ||
      inspectProcessLiveness(instance.operationPid).status !== 'exited'
    ) {
      return
    }
    const receipt = this.ledger.lifecycleReceipt(instance.operationId)
    if (receipt?.status === 'running') {
      receipt.status = 'interrupted'
      receipt.code = 'interrupted'
      receipt.finishedAt = Date.now()
      this.ledger.saveLifecycleReceipt(receipt)
    }
  }
  async refresh(targetId: string): Promise<FlociView> {
    const instance = await this.ensure(targetId)
    if (
      instance.operationId &&
      (this.jobs.has(instance.operationId) ||
        (instance.operationPid &&
          inspectProcessLiveness(instance.operationPid).status !== 'exited'))
    ) {
      return this.view(instance)
    }
    const expected = JSON.stringify(instance)
    this.interruptAbandoned(instance)
    if (instance.operationId) {
      instance.operationId = null
      instance.operationPid = null
      instance.epoch++
    }
    try {
      const run = this.runner(this.root, instance.engine)
      await flociEngineIdentity(run, instance)
      const container = await inspectContainer(run, instance.containerId ?? instance.name)
      if (!container) {
        instance.state = instance.epoch > 0 ? 'stopped' : 'not-started'
        instance.containerId = null
      } else {
        if (!instance.imageId) {
          throw new FlociFailure('instance-conflict')
        }
        const inspected = checkFlociInspection(container, instance, instance.imageId)
        instance.containerId = inspected.id
        instance.state =
          inspected.running && (await flociHealthy(instance.port)) ? 'ready' : 'unknown'
      }
      instance.code = 'complete'
    } catch (error) {
      instance.state = 'unknown'
      instance.code = error instanceof FlociFailure ? error.code : 'engine-unavailable'
    }
    if (this.closed) {
      throw new FlociFailure('interrupted')
    }
    const observed = this.catalog.instances.observe(expected, instance)
    this.notify()
    return this.view(observed)
  }
  async act(
    action: FlociAction,
    assertOwner: () => void,
    assertAdmission = assertOwner
  ): Promise<FlociView> {
    const instance = await this.ensure(action.targetId)
    assertAdmission()
    const existing = this.ledger.lifecycleReceipt(action.requestId)
    if (existing) {
      if (
        existing.targetId !== action.targetId ||
        existing.projectId !== action.projectId ||
        existing.operation !== action.operation ||
        existing.namespaceId !== this.namespaceId
      ) {
        throw new FlociFailure('invalid')
      }
      return this.view(instance)
    }
    if (
      action.operation === 'reset' &&
      (action.confirmation?.targetId !== instance.targetId ||
        action.confirmation.instanceId !== instance.id ||
        action.confirmation.epoch !== instance.epoch)
    ) {
      throw new FlociFailure('confirmation-required')
    }
    this.interruptAbandoned(instance)
    const admitted = this.catalog.instances.acquire(action.targetId, action.requestId)
    const receipt: FlociReceipt = {
      id: action.requestId,
      namespaceId: this.namespaceId,
      projectId: action.projectId,
      targetId: instance.targetId,
      instanceId: instance.id,
      epoch: admitted.epoch,
      operation: action.operation,
      ownerPid: process.pid,
      at: Date.now(),
      finishedAt: null,
      status: 'running',
      code: 'complete'
    }
    try {
      this.ledger.saveLifecycleReceipt(receipt)
    } catch {
      admitted.operationId = null
      admitted.operationPid = null
      this.save(admitted)
      throw new FlociFailure('storage')
    }
    admitted.state =
      action.operation === 'start'
        ? 'starting'
        : action.operation === 'stop'
          ? 'stopping'
          : 'resetting'
    this.save(admitted)
    const job = this.execute(admitted, receipt, assertOwner).finally(() =>
      this.jobs.delete(receipt.id)
    )
    this.jobs.set(receipt.id, job)
    return this.view(admitted)
  }
  private async execute(
    instance: FlociInstance,
    receipt: FlociReceipt,
    checkOwner: () => void
  ): Promise<void> {
    const assertOwner = () => {
      if (this.closed) {
        throw new FlociFailure('interrupted')
      }
      checkOwner()
    }
    try {
      const run = this.runner(this.root, instance.engine)
      if (receipt.operation !== 'start') {
        await stopFloci(instance, run, assertOwner)
      }
      if (receipt.operation === 'reset') {
        assertOwner()
        const expected = join(this.root, 'bastion-cloud', 'data', instance.targetId)
        if (expected !== instance.dataPath) {
          throw new FlociFailure('instance-conflict')
        }
        privateFlociDirectory(dirname(expected))
        privateFlociDirectory(expected)
        if (lstatSync(expected).isSymbolicLink()) {
          throw new FlociFailure('instance-conflict')
        }
        await rm(expected, { recursive: true })
        privateFlociDirectory(expected)
      }
      if (receipt.operation !== 'stop') {
        await startFloci(instance, run, assertOwner, (next) => this.save(next))
      }
      receipt.status = 'passed'
      receipt.code = 'complete'
      instance.code = 'complete'
    } catch (error) {
      receipt.status = 'failed'
      receipt.code = error instanceof FlociFailure ? error.code : 'engine-unavailable'
      instance.code = receipt.code
      instance.state = 'unknown'
    }
    receipt.finishedAt = Date.now()
    instance.operationId = null
    instance.operationPid = null
    if (!this.closed) {
      this.ledger.saveLifecycleReceipt(receipt)
      this.save(instance)
    }
  }
  async settled(): Promise<void> {
    await Promise.allSettled(this.jobs.values())
  }
  close(): void {
    for (const instance of this.catalog.instances.list()) {
      if (instance.operationId && this.jobs.has(instance.operationId)) {
        const receipt = this.ledger.lifecycleReceipt(instance.operationId)
        if (receipt?.status === 'running') {
          receipt.status = 'interrupted'
          receipt.code = 'interrupted'
          receipt.finishedAt = Date.now()
          this.ledger.saveLifecycleReceipt(receipt)
        }
      }
    }
    this.closed = true
  }
}
