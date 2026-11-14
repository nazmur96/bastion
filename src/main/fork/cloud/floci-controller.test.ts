import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { FlociController } from './floci-controller'
import { CloudTargetCatalog } from './cloud-target-catalog'
import { ChangeLedger } from '../changes/change-ledger'
import type { EngineResult, EngineRunner } from './floci-engine'
import type { FlociAction } from '../../../shared/fork-cloud/floci-contract'
let root: string, catalog: CloudTargetCatalog, ledger: ChangeLedger
let id: string
const controllers: FlociController[] = []
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'floci-controller-'))
  catalog = new CloudTargetCatalog(root)
  ledger = new ChangeLedger(root)
  catalog.mutate(0, {
    kind: 'add',
    label: 'Fixture',
    configuration: { kind: 'emulated', provider: 'aws', emulator: 'floci', runtimeId: 'local' }
  })
  id = catalog.snapshot().targets[0].id
})
afterEach(async () => {
  for (const controller of controllers.splice(0)) {
    await controller.settled()
    controller.close()
  }
  ledger.close()
  catalog.close()
  rmSync(root, { recursive: true, force: true })
})
function controller(run: EngineRunner) {
  const result = new FlociController(
    root,
    'fixture',
    catalog,
    ledger,
    () => {},
    () => run
  )
  controllers.push(result)
  return result
}
function start(): FlociAction {
  return { projectId: 'folder:fixture', targetId: id, requestId: randomUUID(), operation: 'start' }
}
const fail: EngineResult = {
  code: 1,
  stdout: '',
  stderr: 'no policy.json file found at /private/personal/path',
  timedOut: false
}
it('records a direct failed receipt with fixed diagnosis and replays without new engine work', async () => {
  let calls = 0
  const owner = controller(async () => {
    calls++
    return fail
  })
  const action = start()
  await owner.act(action, () => {})
  await owner.settled()
  const receipt = ledger.lifecycleReceipt(action.requestId)
  expect(receipt).toMatchObject({
    status: 'failed',
    code: 'container-policy-missing',
    operation: 'start'
  })
  expect(JSON.stringify(receipt)).not.toContain('/private')
  const before = calls
  await owner.act(action, () => {})
  await owner.settled()
  expect(calls).toBe(before)
  expect(ledger.lifecycleReceipts(id)).toHaveLength(1)
})
it('requires exact target/instance/epoch reset confirmation before engine work or receipt', async () => {
  const owner = controller(async () => {
    throw new Error('Engine must not be called')
  })
  const action = { ...start(), operation: 'reset' } as const
  await expect(owner.act(action, () => {})).rejects.toThrow('Confirm Reset')
  expect(ledger.lifecycleReceipts(id)).toHaveLength(0)
})
it('serializes operations across owners and records interruption without later claiming success', async () => {
  let finish: (value: EngineResult) => void = () => {}
  const pending = new Promise<EngineResult>((resolve) => {
    finish = resolve
  })
  const first = controller(() => pending),
    second = controller(async () => fail)
  const action = start()
  await first.act(action, () => {})
  try {
    await expect(second.act(start(), () => {})).rejects.toThrow('active')
    const current = await second.refresh(id)
    expect(current.instance.operationId).toBe(action.requestId)
    first.close()
    expect(ledger.lifecycleReceipt(action.requestId)?.status).toBe('interrupted')
  } finally {
    finish(fail)
    await first.settled()
  }
  expect(ledger.lifecycleReceipt(action.requestId)?.status).toBe('interrupted')
})
it('does not let a delayed refresh overwrite a newer lifecycle admission', async () => {
  let observed: () => void = () => {},
    finish: (value: EngineResult) => void = () => {}
  const entered = new Promise<void>((resolve) => {
    observed = resolve
  })
  const pending = new Promise<EngineResult>((resolve) => {
    finish = resolve
  })
  const owner = controller(async (args) => {
    if (args[0] === 'info') {
      observed()
      return pending
    }
    return { ...fail, stderr: 'No such container' }
  })
  await owner.ensure(id)
  const refresh = owner.refresh(id)
  await entered
  const operationId = randomUUID()
  const admitted = catalog.instances.acquire(id, operationId)
  finish({ code: 0, stdout: '{"ID":"fixture-daemon"}', stderr: '', timedOut: false })
  const result = await refresh
  expect(result.instance.operationId).toBe(operationId)
  expect(catalog.instances.get(id)?.epoch).toBe(admitted.epoch)
})
it('records an abandoned owner as interrupted even when its engine cannot be reached', async () => {
  const owner = controller(async () => fail)
  const instance = await owner.ensure(id),
    operationId = randomUUID()
  instance.operationId = operationId
  instance.operationPid = 2147483647
  instance.epoch = 1
  catalog.instances.save(instance)
  ledger.saveLifecycleReceipt({
    id: operationId,
    namespaceId: 'fixture',
    projectId: 'folder:fixture',
    targetId: id,
    instanceId: instance.id,
    epoch: 1,
    operation: 'start',
    ownerPid: 2147483647,
    at: Date.now(),
    finishedAt: null,
    status: 'running',
    code: 'complete'
  })
  const result = await owner.refresh(id)
  expect(result.instance).toMatchObject({ operationId: null, state: 'unknown', epoch: 2 })
  expect(ledger.lifecycleReceipt(operationId)).toMatchObject({
    status: 'interrupted',
    code: 'interrupted'
  })
})
