import { createServer } from 'node:http'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import * as engine from './floci-engine'
import { flociHealthy } from './floci-health'
import { FlociController } from './floci-controller'
import { CloudTargetCatalog } from './cloud-target-catalog'
import { ChangeLedger } from '../changes/change-ledger'
const evidence = z
  .object({
    providers: z.array(
      z.object({
        provider: z.enum(['azure', 'gcp', 'oci']),
        image: z.string(),
        containerPort: z.number(),
        readyPath: z.string(),
        prefix: z.string()
      })
    )
  })
  .parse(
    JSON.parse(
      readFileSync(
        join(import.meta.dirname, '../../../../tests/fixtures/cloud/floci-products-research.json'),
        'utf8'
      )
    )
  )
const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})
function directory() {
  const root = mkdtempSync(join(tmpdir(), 'floci-multicloud-'))
  roots.push(root)
  return root
}
const manifest = {
  namespaceId: 'workspace-fixture',
  targetId: '10000000-0000-4000-8000-000000000001',
  id: '20000000-0000-4000-8000-000000000001',
  name: 'bastion-provider-fixture',
  network: 'bastion-provider-network',
  dataPath: '/private/fixture',
  port: 14777
}
describe('MC-01/02 provider specialization of the existing Floci owner lifecycle', () => {
  it.each(evidence.providers)(
    'admits $provider through the same fixed argv builder with its own digest/port/persistence',
    (product) => {
      const args = engine.flociCreateArgs({ ...manifest, provider: product.provider })
      expect(args).toContain(product.image)
      expect(args).toContain(`127.0.0.1:${manifest.port}:${product.containerPort}/tcp`)
      expect(args).toContain(`${product.prefix}_STORAGE_MODE=persistent`)
      expect(args).toContain('type=bind,source=/private/fixture,target=/app/data')
      expect(args).toContain('/app/application')
      expect(args).toContain('ALL')
      expect(args).toContain('no-new-privileges')
      expect(args.some((arg) => arg.startsWith('seccomp='))).toBe(true)
      expect(args.filter((arg) => arg === '--publish')).toHaveLength(1)
      expect(args.join(' ')).not.toMatch(/docker\.sock|--privileged|--cap-add|:latest|:nightly/)
      expect(args.join(' ')).not.toContain('floci.security.allow-unsafe-network-exposure')
    }
  )
  it.each(evidence.providers)(
    'uses $provider readiness semantics rather than AWS or a timed success fallback',
    async (product) => {
      const paths: string[] = []
      const server = createServer((req, res) => {
        paths.push(req.url ?? '')
        res.writeHead(req.url === product.readyPath ? 200 : 404, {
          'Content-Type': 'application/json'
        })
        res.end(
          JSON.stringify(
            product.provider === 'azure' ? { status: 'UP' } : { completed: { ready: true } }
          )
        )
      })
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
      try {
        const address = server.address()
        if (!address || typeof address === 'string') {
          throw new Error('Missing loopback fixture')
        }
        expect(await Reflect.apply(flociHealthy, undefined, [address.port, product.provider])).toBe(
          true
        )
        expect(paths).toEqual([product.readyPath])
      } finally {
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve()))
        )
      }
    }
  )
  it.each(evidence.providers)(
    'records $provider start failure and duplicate UUID using existing lifecycle receipts',
    async ({ provider }) => {
      const root = directory(),
        catalog = new CloudTargetCatalog(root),
        ledger = new ChangeLedger(root)
      let count = 0
      const run: engine.EngineRunner = async () => {
        count++
        return {
          code: 1,
          stdout: '',
          stderr: 'container signature policy.json missing',
          timedOut: false
        }
      }
      catalog.mutate(0, {
        kind: 'add',
        label: 'Provider fixture',
        configuration: { kind: 'emulated', provider, emulator: 'floci', runtimeId: 'local' }
      })
      const targetId = catalog.snapshot().targets[0].id
      const owner = new FlociController(
        root,
        'fixture',
        catalog,
        ledger,
        () => {},
        () => run
      )
      const action = {
        projectId: 'folder:fixture',
        targetId,
        requestId: '30000000-0000-4000-8000-000000000001',
        operation: 'start'
      } as const
      try {
        await owner.act(action, () => {})
        await owner.settled()
        expect(ledger.lifecycleReceipt(action.requestId)).toMatchObject({
          status: 'failed',
          code: 'container-policy-missing',
          targetId
        })
        expect(count).toBeGreaterThan(0)
        const before = count
        await owner.act(action, () => {})
        await owner.settled()
        expect(count).toBe(before)
      } finally {
        await owner.settled()
        owner.close()
        ledger.close()
        catalog.close()
      }
    }
  )
  it.each(evidence.providers)(
    'keeps $provider Reset target-specific before any engine operation',
    async ({ provider }) => {
      const root = directory(),
        catalog = new CloudTargetCatalog(root),
        ledger = new ChangeLedger(root)
      catalog.mutate(0, {
        kind: 'add',
        label: 'Reset fixture',
        configuration: { kind: 'emulated', provider, emulator: 'floci', runtimeId: 'local' }
      })
      const targetId = catalog.snapshot().targets[0].id
      let calls = 0
      const owner = new FlociController(
        root,
        'fixture',
        catalog,
        ledger,
        () => {},
        () => async () => {
          calls++
          throw new Error('Engine must not run')
        }
      )
      try {
        await expect(
          owner.act(
            {
              projectId: 'folder:fixture',
              targetId,
              requestId: '40000000-0000-4000-8000-000000000001',
              operation: 'reset'
            },
            () => {}
          )
        ).rejects.toThrow(/Confirm Reset/)
        expect(calls).toBe(0)
        expect(ledger.lifecycleReceipts(targetId)).toHaveLength(0)
      } finally {
        owner.close()
        ledger.close()
        catalog.close()
      }
    }
  )
})
