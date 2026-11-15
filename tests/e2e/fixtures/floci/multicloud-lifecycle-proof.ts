import { strict as assert } from 'node:assert'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runProcess } from '@orca/process-host'
import { CloudTargetCatalog } from '../../../../src/main/fork/cloud/cloud-target-catalog'
import { ChangeLedger } from '../../../../src/main/fork/changes/change-ledger'
import { FlociController } from '../../../../src/main/fork/cloud/floci-controller'
import { ownerEngineRunner } from '../../../../src/main/fork/cloud/floci-paths'
import { flociProduct, type FlociProvider } from '../../../../src/shared/fork-cloud/floci-products'
import { flociHealthy } from '../../../../src/main/fork/cloud/floci-health'
import { checkFlociInspection } from '../../../../src/main/fork/cloud/floci-inspection'
import type { FlociAction } from '../../../../src/shared/fork-cloud/floci-contract'

async function main(): Promise<void> {
  assert.equal(process.platform, 'linux')
  assert.equal(process.arch, 'x64')
  writeFileSync('/sys/fs/cgroup/init/cgroup.procs', String(process.pid))
  if (process.getuid?.() === 0) {
    process.setgid?.(statSync('/var/run/docker.sock').gid)
    process.setuid?.(1000)
  }
  assert.notEqual(process.getuid?.(), 0)
  const base = mkdtempSync(join(tmpdir(), 'floci-multicloud-production-'))
  const fixtures: ReturnType<typeof fixture>[] = []
  function fixture(provider: FlociProvider, label: string) {
    const root = join(base, provider + label)
    mkdirSync(root, { mode: 0o700 })
    const catalog = new CloudTargetCatalog(root),
      ledger = new ChangeLedger(root)
    catalog.mutate(0, {
      kind: 'add',
      label,
      configuration: {
        kind: 'emulated',
        provider,
        emulator: 'floci',
        runtimeId: 'local',
        engine: 'docker'
      }
    })
    const targetId = catalog.snapshot().targets[0].id
    const controller = new FlociController(root, randomUUID(), catalog, ledger)
    return { root, catalog, ledger, targetId, controller, provider }
  }
  async function act(f: ReturnType<typeof fixture>, operation: FlociAction['operation']) {
    const before = await f.controller.ensure(f.targetId)
    const request: FlociAction = {
      projectId: 'folder:fixture',
      targetId: f.targetId,
      operation,
      requestId: randomUUID(),
      ...(operation === 'reset'
        ? { confirmation: { targetId: f.targetId, instanceId: before.id, epoch: before.epoch } }
        : {})
    }
    await f.controller.act(request, () => {})
    await f.controller.settled()
    const receipt = f.ledger.lifecycleReceipt(request.requestId)
    if (receipt?.status !== 'passed') {
      const instance = f.catalog.instances.get(f.targetId)
      if (instance?.containerId) {
        console.log(
          await ownerEngineRunner(f.root, 'docker')(['logs', '--tail', '30', instance.containerId])
        )
      }
    }
    assert.equal(receipt?.status, 'passed', JSON.stringify(receipt))
    await f.controller.act(request, () => {})
    await f.controller.settled()
    assert.deepEqual(f.ledger.lifecycleReceipt(request.requestId), receipt)
    const after = f.catalog.instances.get(f.targetId)
    assert(after)
    return after
  }
  try {
    for (const provider of ['azure', 'gcp', 'oci'] as const) {
      const a = fixture(provider, 'A'),
        b = fixture(provider, 'B')
      fixtures.push(a, b)
      const first = await act(a, 'start'),
        second = await act(b, 'start')
      assert.equal(first.state, 'ready')
      assert.equal(second.state, 'ready')
      assert.notEqual(first.port, second.port)
      assert.notEqual(first.dataPath, second.dataPath)
      assert.notEqual(first.containerId, second.containerId)
      for (const [f, instance] of [
        [a, first],
        [b, second]
      ] as const) {
        const run = ownerEngineRunner(f.root, 'docker')
        const result = await run(['inspect', instance.containerId ?? instance.name])
        assert.equal(result.code, 0)
        const raw = JSON.parse(result.stdout)[0]
        checkFlociInspection(raw, instance, instance.imageId ?? '', provider)
        assert.equal(raw.HostConfig.ReadonlyRootfs, true)
        assert.equal(raw.HostConfig.Privileged, false)
        assert.equal(raw.Config.User.split(':')[0], '1000')
        assert.equal(
          raw.HostConfig.PortBindings[`${flociProduct(provider).port}/tcp`][0].HostIp,
          '127.0.0.1'
        )
        console.log(
          `PRODUCTION_INSPECT ${JSON.stringify({ provider, containerId: instance.containerId, image: raw.Config.Image, imageId: raw.Image, user: raw.Config.User, security: raw.HostConfig.SecurityOpt, ports: raw.HostConfig.PortBindings, mounts: raw.Mounts })}`
        )
      }
      // This is a private-directory lifecycle sentinel, not a resource-listing proof.
      const marker = join(first.dataPath, 'proof-sentinel')
      writeFileSync(marker, 'A')
      const markerB = join(second.dataPath, 'proof-sentinel')
      writeFileSync(markerB, 'B')
      await act(a, 'stop')
      assert.equal(readFileSync(marker, 'utf8'), 'A')
      const restarted = await act(a, 'start')
      assert.notEqual(restarted.containerId, first.containerId)
      assert.equal(readFileSync(marker, 'utf8'), 'A')
      const reset = await act(a, 'reset')
      assert.equal(reset.state, 'ready')
      assert.equal(existsSync(marker), false)
      assert.equal(readFileSync(markerB, 'utf8'), 'B')
      assert(await flociHealthy(second.port, provider))
      const refreshed = await b.controller.refresh(b.targetId)
      assert.equal(refreshed.instance.state, 'ready')
      await act(a, 'stop')
      await act(b, 'stop')
      console.log(
        `PRODUCTION_PROOF ${JSON.stringify({ provider, platform: 'linux/amd64', twoNamespaces: true, startStopReset: true, receiptReplay: true, privateDataRetained: true, resetScoped: true, statusReady: true })}`
      )
    }
  } finally {
    for (const f of fixtures) {
      const instance = f.catalog.instances.get(f.targetId)
      if (instance?.containerId) {
        await act(f, 'stop')
      }
      f.controller.close()
      f.ledger.close()
      f.catalog.close()
    }
    const remaining = await runProcess({ program: 'docker', args: ['ps', '-aq'], timeoutMs: 5000 })
    assert.equal(remaining.stdout.trim(), '')
    console.log('CLEANUP containers=0')
  }
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
