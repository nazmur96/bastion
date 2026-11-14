import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CloudTargetCatalog } from './cloud-target-catalog'
import { ChangeLedger } from '../changes/change-ledger'
import {
  admitCloudChange,
  captureCatalogBinding,
  cloudSnapshotHash,
  setCloudBindingAuthority
} from './cloud-binding-authority'
import { getDiskBaselineSignature } from '../../../shared/disk-baseline-signature'
import type {
  ChangeCommand,
  ChangeRecord,
  ChangeSnapshot
} from '../../../shared/fork-changes/change-contract'

let root: string, catalog: CloudTargetCatalog, ledger: ChangeLedger
const scope = { projectId: 'folder:fixture', root: '/fixture', hostId: 'local', routeKey: 'local' }
const owner = { hostId: 'local', root: scope.root } as const
const namespaceId = '10000000-0000-4000-8000-000000000001'
let a: string, b: string
const capture = () => captureCatalogBinding(catalog, namespaceId, scope, 'runtime', 'registration')
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'bound-admission-'))
  catalog = new CloudTargetCatalog(root)
  ledger = new ChangeLedger(root)
  for (const label of ['A', 'B']) {
    catalog.mutate(catalog.snapshot().revision, {
      kind: 'add',
      label,
      configuration: { kind: 'emulated', provider: 'aws', emulator: 'floci', runtimeId: 'local' }
    })
  }
  ;[a, b] = catalog.snapshot().targets.map((target) => target.id)
  catalog.instances.reserve(namespaceId, a, root, 14566, 'docker')
  catalog.instances.reserve(namespaceId, b, root, 14567, 'docker')
  catalog.select(catalog.snapshot().revision, scope.projectId, a, owner)
  setCloudBindingAuthority({
    capture: async () => ({ binding: capture(), current: capture, catalog }),
    claim: () => () => {}
  })
})
afterEach(() => {
  setCloudBindingAuthority(undefined)
  ledger.close()
  catalog.close()
  rmSync(root, { recursive: true, force: true })
})
function snapshot(): ChangeSnapshot {
  return {
    adapter: 'source-check/v1',
    ownerRuntimeId: 'runtime',
    files: [{ path: 'app.json', fingerprint: getDiskBaselineSignature('{}') }],
    cloudBinding: capture()
  }
}
async function command(record: ChangeRecord, cmd: ChangeCommand) {
  return admitCloudChange(
    record,
    cmd,
    () => ledger.command(record.id, record.revision, cmd),
    () => {
      ledger.command(record.id, record.revision, { kind: 'invalidate' })
    }
  )
}
async function reviewed() {
  const prepared = snapshot()
  let record = ledger.ensure(scope, 'cloud', {
    id: 'source-check:cloud',
    kind: 'source-check',
    targetMode: 'selected-cloud'
  })
  record = await command(record, { kind: 'validate', snapshot: prepared })
  record = await command(record, {
    kind: 'review',
    validationId: record.validations.at(-1)!.id,
    snapshot: prepared
  })
  return { record, prepared }
}
describe('authoritative cloud-bound run admission', () => {
  it('CT-05 refuses A-B-A without an attempt or receipt, even with no renderer events', async () => {
    const { record, prepared } = await reviewed()
    catalog.select(catalog.snapshot().revision, scope.projectId, b, owner)
    catalog.select(catalog.snapshot().revision, scope.projectId, a, owner)
    await expect(
      command(record, {
        kind: 'start',
        reviewId: record.reviews[0].id,
        snapshot: prepared,
        execution: { runtimeId: 'runtime' }
      })
    ).rejects.toThrow('Cloud target changed')
    expect(ledger.get(record.id).runs).toHaveLength(0)
    expect(ledger.get(record.id).invalidated).toBe(true)
    expect(ledger.lifecycleReceipts(a)).toHaveLength(0)
  })
  it('pins admitted work, prevents lifecycle overlap and refuses forged owner admission', async () => {
    const { record, prepared } = await reviewed()
    const started = await command(record, {
      kind: 'start',
      reviewId: record.reviews[0].id,
      snapshot: prepared,
      execution: { runtimeId: 'runtime' }
    })
    const run = started.runs[0],
      binding = capture()
    expect(() => catalog.instances.acquire(a, '40000000-0000-4000-8000-000000000001')).toThrow(
      'active'
    )
    expect(() => catalog.instances.claimSource(run.id, binding, 'forged')).toThrow('stale')
    catalog.select(catalog.snapshot().revision, scope.projectId, b, owner)
    catalog.instances.claimSource(run.id, binding, cloudSnapshotHash(prepared))
    expect(() => catalog.instances.assertRemovable(a)).toThrow('active')
    catalog.instances.releaseSource(run.id)
    expect(catalog.instances.acquire(a, '40000000-0000-4000-8000-000000000001').epoch).toBe(
      binding.instance.epoch + 1
    )
  })
  it('rename preserves binding; stopping/restarting the instance invalidates it', async () => {
    const { record, prepared } = await reviewed()
    catalog.mutate(catalog.snapshot().revision, { kind: 'rename', id: a, label: 'Readable name' })
    expect(capture()).toEqual(prepared.cloudBinding)
    const instance = catalog.instances.acquire(a, '40000000-0000-4000-8000-000000000001')
    instance.operationId = null
    instance.operationPid = null
    catalog.instances.save(instance)
    await expect(
      command(record, { kind: 'start', reviewId: record.reviews[0].id, snapshot: prepared })
    ).rejects.toThrow('Cloud target changed')
    expect(ledger.get(record.id).runs).toHaveLength(0)
  })
  it('does not consult cloud authority for ordinary targetless managed-SSH source checks', async () => {
    setCloudBindingAuthority(undefined)
    const remote = { ...scope, hostId: 'managed-ssh', routeKey: 'remote-pairing' }
    const record = ledger.ensure(remote, 'source')
    const source: ChangeSnapshot = {
      adapter: 'source-check/v1',
      ownerRuntimeId: 'remote-runtime',
      files: [{ path: 'app.json', fingerprint: getDiskBaselineSignature('{}') }]
    }
    const result = await command(record, { kind: 'validate', snapshot: source })
    expect(result.validations[0].snapshot).toEqual(source)
  })
})
