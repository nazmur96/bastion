import { strict as assert } from 'node:assert'
import { randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir, networkInterfaces } from 'node:os'
import { join } from 'node:path'
import { request } from 'node:http'
import { createConnection } from 'node:net'
import { CloudTargetCatalog } from '../../../../src/main/fork/cloud/cloud-target-catalog'
import { ChangeLedger } from '../../../../src/main/fork/changes/change-ledger'
import { FlociController } from '../../../../src/main/fork/cloud/floci-controller'
import { ownerEngineRunner } from '../../../../src/main/fork/cloud/floci-paths'
import { inspectContainer, engineCall } from '../../../../src/main/fork/cloud/floci-engine'
import type { FlociAction } from '../../../../src/shared/fork-cloud/floci-contract'
import { listFlociResources } from '../../../../src/main/fork/cloud/floci-resources'

function http(
  port: number,
  method: string,
  path: string
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port, method, path, agent: false }, (res) => {
      let body = ''
      res.on('data', (chunk) => {
        body += String(chunk)
      })
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }))
    })
    req.setTimeout(5000, () => req.destroy(new Error('HTTP timeout')))
    req.on('error', reject)
    req.end()
  })
}
async function refused(host: string, port: number): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const socket = createConnection({ host, port })
    socket.setTimeout(3000, () =>
      socket.destroy(new Error('Connection timed out rather than refused'))
    )
    socket.once('connect', () => {
      socket.destroy()
      reject(new Error('Non-loopback connection succeeded'))
    })
    socket.once('error', (error) => {
      if ('code' in error && error.code === 'ECONNREFUSED') {
        resolve()
      } else {
        reject(error)
      }
    })
  })
}
async function main(): Promise<void> {
  writeFileSync('/sys/fs/cgroup/init/cgroup.procs', String(process.pid))
  if (process.getuid?.() === 0) {
    process.setgid?.(statSync('/var/run/docker.sock').gid)
    process.setuid?.(1000)
  }
  const base = mkdtempSync(join(tmpdir(), 'bastion-floci-live-'))
  const fixtures = ['Alpha', 'Beta'].map((label) => {
    const root = join(base, label)
    mkdirSync(root, { mode: 0o700 })
    const catalog = new CloudTargetCatalog(root),
      ledger = new ChangeLedger(root)
    catalog.mutate(0, {
      kind: 'add',
      label,
      configuration: {
        kind: 'emulated',
        provider: 'aws',
        emulator: 'floci',
        runtimeId: 'local',
        engine: 'docker'
      }
    })
    const id = catalog.snapshot().targets[0].id
    const controller = new FlociController(
      root,
      randomUUID(),
      catalog,
      ledger,
      () => {},
      (ownerRoot, engine) => {
        const run = ownerEngineRunner(ownerRoot, engine)
        return async (args) => {
          const result = await run(args)
          if (result.code !== 0) {
            console.error('ENGINE', args[0], result.stderr)
          }
          return result
        }
      }
    )
    return { root, catalog, ledger, controller, id }
  })
  const [a, b] = fixtures
  async function action(fixture: typeof a, operation: FlociAction['operation']) {
    const instance = await fixture.controller.ensure(fixture.id)
    const args: FlociAction = {
      projectId: 'folder:fixture',
      targetId: fixture.id,
      requestId: randomUUID(),
      operation,
      ...(operation === 'reset'
        ? { confirmation: { targetId: fixture.id, instanceId: instance.id, epoch: instance.epoch } }
        : {})
    }
    await fixture.controller.act(args, () => {})
    await fixture.controller.settled()
    const result = fixture.catalog.instances.get(fixture.id)
    assert(result)
    const receipt = fixture.ledger.lifecycleReceipt(args.requestId)
    if (receipt?.status !== 'passed') {
      const run = ownerEngineRunner(fixture.root, 'docker')
      if (result.containerId) {
        console.error(
          'Emulator diagnostics',
          await run(['logs', '--tail', '30', result.containerId])
        )
      }
    }
    assert.equal(receipt?.status, 'passed', JSON.stringify(receipt))
    // Same request ID must be idempotent and retain its original receipt.
    await fixture.controller.act(args, () => {})
    assert.deepEqual(fixture.ledger.lifecycleReceipt(args.requestId), receipt)
    return result
  }
  try {
    const starts = await Promise.allSettled([action(a, 'start'), action(b, 'start')])
    for (const result of starts) {
      if (result.status === 'rejected') {
        throw result.reason
      }
    }
    const ai = a.catalog.instances.get(a.id),
      bi = b.catalog.instances.get(b.id)
    assert(ai && bi)
    assert.equal(ai.state, 'ready')
    assert.equal(bi.state, 'ready')
    assert.notEqual(ai.port, bi.port)
    assert.notEqual(ai.dataPath, bi.dataPath)
    assert.notEqual(ai.containerId, bi.containerId)
    const inspect = await inspectContainer(
      ownerEngineRunner(a.root, 'docker'),
      ai.containerId ?? ai.name
    )
    console.log('ADMITTED_INSPECT', JSON.stringify(inspect))
    const nonLoopback = Object.values(networkInterfaces())
      .flat()
      .find((value) => value?.family === 'IPv4' && !value.internal)?.address
    const outbound = await ownerEngineRunner(
      a.root,
      'docker'
    )(['exec', ai.containerId ?? ai.name, '/usr/local/bin/healthcheck.sh'])
    assert.notEqual(outbound.code, 0, 'Container-originated connections must be denied')
    console.log('OUTBOUND_DENIED', outbound.code, outbound.stderr)
    assert(nonLoopback)
    await refused(nonLoopback, ai.port)
    await refused(nonLoopback, bi.port)
    assert.equal((await http(ai.port, 'PUT', '/bastion-persistence-proof')).status, 200)
    assert(!(await http(bi.port, 'GET', '/')).body.includes('bastion-persistence-proof'))
    // The production read-only listers against the real pinned emulator.
    const listed = await listFlociResources(ai.port)
    const s3 = listed.results.find((result) => result.service === 's3')
    assert.equal(s3?.status, 'ok', JSON.stringify(s3))
    assert(s3.items.some((item) => item.name === 'bastion-persistence-proof'))
    for (const result of listed.results) {
      assert(
        ['ok', 'unimplemented'].includes(result.status),
        `${result.service} listing: ${result.status}`
      )
    }
    const otherListed = await listFlociResources(bi.port)
    assert(
      !otherListed.results.some((result) =>
        result.items.some((item) => item.name === 'bastion-persistence-proof')
      )
    )
    console.log(
      'LISTED',
      JSON.stringify(
        listed.results.map((result) => [result.service, result.status, result.items.length])
      )
    )
    await action(a, 'stop')
    assert.equal((await action(a, 'start')).state, 'ready')
    assert((await http(ai.port, 'GET', '/')).body.includes('bastion-persistence-proof'))
    await action(a, 'reset')
    assert(!(await http(ai.port, 'GET', '/')).body.includes('bastion-persistence-proof'))
    assert.equal((await http(bi.port, 'GET', '/_floci/health')).status, 200)
    console.log(
      'PROOF',
      JSON.stringify({
        concurrentWorkspaces: true,
        loopbackOnly: true,
        nonLoopbackRefused: true,
        persistenceAcrossStop: true,
        resetScoped: true,
        listersAgainstEmulator: true,
        receiptsIdempotent: true
      })
    )
  } finally {
    for (const fixture of fixtures) {
      try {
        await action(fixture, 'stop')
      } finally {
        fixture.controller.close()
        fixture.ledger.close()
        fixture.catalog.close()
      }
    }
    assert.equal(await engineCall(ownerEngineRunner(a.root, 'docker'), ['ps', '-aq']), '')
    console.log('CLEANUP containers=0')
    rmSync(base, { recursive: true, force: true })
  }
}
void main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
