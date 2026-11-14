import { createHash, randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type Database from '../../sqlite/sync-database'
import {
  flociInstanceSchema,
  FlociFailure,
  type FlociInstance
} from '../../../shared/fork-cloud/floci-contract'
import { sameCloudBinding, type BoundCloud } from '../../../shared/fork-cloud/cloud-binding'
import { inspectProcessLiveness } from '../../daemon/daemon-process-inspection'

function decode(row: Record<string, unknown> | undefined): FlociInstance | null {
  return row ? flociInstanceSchema.parse(JSON.parse(String(row.record))) : null
}
export class FlociJournal {
  constructor(private readonly db: Database.Database) {}
  get(targetId: string): FlociInstance | null {
    return decode(
      this.db.prepare('SELECT record FROM cloud_instances WHERE target_id = ?').get(targetId)
    )
  }
  list(): FlociInstance[] {
    return this.db
      .prepare('SELECT record FROM cloud_instances')
      .all()
      .map((row) => flociInstanceSchema.parse(JSON.parse(String(row.record))))
  }
  save(instance: FlociInstance): void {
    flociInstanceSchema.parse(instance)
    this.db
      .prepare('INSERT OR REPLACE INTO cloud_instances VALUES (?, ?)')
      .run(instance.targetId, JSON.stringify(instance))
  }
  observe(expected: string, observed: FlociInstance): FlociInstance {
    return this.atomic(() => {
      const current = this.get(observed.targetId)
      if (!current) {
        throw new FlociFailure('invalid')
      }
      if (JSON.stringify(current) !== expected) {
        return current
      }
      this.save(observed)
      return observed
    })
  }
  atomic<T>(action: () => T): T {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const result = action()
      this.db.exec('COMMIT')
      return result
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }
  reserve(
    namespaceId: string,
    targetId: string,
    root: string,
    port: number,
    engine: 'docker' | 'podman'
  ): FlociInstance {
    return this.atomic(() => {
      const previous = this.get(targetId)
      if (previous) {
        return previous
      }
      if (this.list().some((instance) => instance.port === port)) {
        throw new FlociFailure('port-conflict')
      }
      const id = randomUUID(),
        name = `bastion-${createHash('sha256')
          .update(JSON.stringify([namespaceId, targetId, id]))
          .digest('hex')
          .slice(0, 40)}`
      const instance: FlociInstance = {
        id,
        namespaceId,
        targetId,
        name,
        network: `${name}-net`,
        port,
        dataPath: join(root, 'bastion-cloud', 'data', targetId),
        engine,
        engineId: `unobserved:${engine}`,
        containerId: null,
        imageId: null,
        epoch: 0,
        state: 'not-started',
        code: 'complete',
        operationId: null,
        operationPid: null
      }
      this.save(instance)
      return instance
    })
  }
  private activeSources(targetId: string): boolean {
    let active = false
    for (const row of this.db
      .prepare(
        'SELECT id, target_id, pid, expires, state FROM cloud_source_admissions WHERE target_id = ?'
      )
      .all(targetId)) {
      const dead =
        typeof row.pid === 'number' && inspectProcessLiveness(row.pid).status === 'exited'
      if (dead || (row.state === 'pending' && Number(row.expires) < Date.now())) {
        this.db.prepare('DELETE FROM cloud_source_admissions WHERE id = ?').run(String(row.id))
      } else {
        active = true
      }
    }
    return active
  }
  acquire(targetId: string, operationId: string): FlociInstance {
    return this.atomic(() => {
      const instance = this.get(targetId)
      if (!instance) {
        throw new FlociFailure('invalid')
      }
      if (
        instance.operationId &&
        instance.operationPid &&
        inspectProcessLiveness(instance.operationPid).status !== 'exited'
      ) {
        throw new FlociFailure('busy')
      }
      if (this.activeSources(targetId)) {
        throw new FlociFailure('busy')
      }
      instance.epoch++
      instance.operationId = operationId
      instance.operationPid = process.pid
      this.save(instance)
      return instance
    })
  }
  assertRemovable(targetId: string): void {
    const instance = this.get(targetId)
    if (
      instance &&
      (instance.operationId ||
        !['not-started', 'stopped'].includes(instance.state) ||
        this.activeSources(targetId))
    ) {
      throw new FlociFailure('busy')
    }
  }
  admitSource<T>(
    expected: BoundCloud,
    current: () => BoundCloud,
    snapshotHash: string,
    start: () => { value: T; runId: string }
  ): T {
    return this.atomic(() => {
      if (!sameCloudBinding(expected, current())) {
        throw new Error('Cloud target changed. Prepare and review again.')
      }
      const instance = this.get(expected.targetId)
      if (!instance || instance.operationId) {
        throw new FlociFailure('busy')
      }
      const result = start()
      this.db
        .prepare('INSERT INTO cloud_source_admissions VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(
          result.runId,
          expected.targetId,
          JSON.stringify(expected),
          snapshotHash,
          process.pid,
          Date.now() + 30000,
          'pending'
        )
      return result.value
    })
  }
  claimSource(id: string, binding: BoundCloud, snapshotHash: string): void {
    this.atomic(() => {
      const row = this.db.prepare('SELECT * FROM cloud_source_admissions WHERE id = ?').get(id)
      if (
        !row ||
        row.pid !== process.pid ||
        row.snapshot_hash !== snapshotHash ||
        row.binding !== JSON.stringify(binding) ||
        (row.state === 'pending' && Number(row.expires) < Date.now())
      ) {
        throw new Error('Cloud run admission is unavailable or stale.')
      }
      const instance = this.get(binding.targetId)
      if (
        !instance ||
        instance.id !== binding.instance.id ||
        instance.epoch !== binding.instance.epoch ||
        instance.operationId
      ) {
        throw new Error('Cloud target instance changed.')
      }
      this.db.prepare("UPDATE cloud_source_admissions SET state = 'active' WHERE id = ?").run(id)
    })
  }
  releaseSource(id: string): void {
    this.db.prepare('DELETE FROM cloud_source_admissions WHERE id = ?').run(id)
  }
}
