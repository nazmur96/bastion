import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { flociTargetEnv } from './floci-target-env'
import { flociInstanceSchema } from '../../../shared/fork-cloud/floci-contract'
const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})
function instance(root: string) {
  return flociInstanceSchema.parse({
    id: '10000000-0000-4000-8000-000000000001',
    namespaceId: 'workspace-fixture',
    targetId: '20000000-0000-4000-8000-000000000001',
    name: 'bastion-fixture',
    network: 'bastion-fixture-net',
    port: 14888,
    dataPath: join(root, 'data'),
    engine: 'docker',
    engineId: 'fixture',
    containerId: 'a'.repeat(64),
    imageId: 'sha256:fixture',
    epoch: 1,
    state: 'ready',
    code: 'complete',
    operationId: null,
    operationPid: null
  })
}
function files(root: string): string {
  return readdirSync(root)
    .map((name) => {
      const path = join(root, name)
      return statSync(path).isDirectory() ? files(path) : readFileSync(path, 'utf8')
    })
    .join('\n')
}
describe('MC-03 per-provider sealed contexts, not ambient credential overlays', () => {
  it.each(['azure', 'gcp', 'oci'])(
    'builds the %s SDK profile only from the admitted instance and private config',
    (provider) => {
      const root = mkdtempSync(join(tmpdir(), 'sealed-provider-'))
      roots.push(root)
      const env = z.record(z.string(), z.string()).parse(
        Reflect.apply(flociTargetEnv, undefined, [
          root,
          instance(root),
          '',
          provider,
          {
            HOME: '/fixture/real-home',
            AZURE_CLIENT_SECRET: 'PLANTED_REAL_SECRET',
            GOOGLE_APPLICATION_CREDENTIALS: 'PLANTED_REAL_ADC',
            OCI_CLI_KEY_CONTENT: 'PLANTED_REAL_KEY',
            OCI_RESOURCE_PRINCIPAL_RPST: 'PLANTED_REAL_TOKEN',
            HTTPS_PROXY: 'https://proxy.invalid'
          }
        ])
      )
      expect(JSON.stringify(env)).not.toContain('PLANTED_REAL')
      expect(env.HOME).toBeTruthy()
      expect(env.HOME).not.toBe(process.env.HOME)
      expect(env.NO_PROXY).toContain('127.0.0.1')
      expect(env).not.toHaveProperty('AWS_ACCESS_KEY_ID', 'test')
      expect(env.HTTP_PROXY ?? '').toBe('')
      expect(env.HTTPS_PROXY ?? '').toBe('')
      expect(env.AZURE_CLIENT_SECRET ?? '').toBe('')
      expect(env.GOOGLE_APPLICATION_CREDENTIALS ?? '').toBe('')
      expect(env.OCI_CLI_KEY_CONTENT ?? '').toBe('')
      expect(env.OCI_RESOURCE_PRINCIPAL_RPST ?? '').toBe('')
      if (provider === 'azure') {
        expect(env.AZURE_CONFIG_DIR).toContain(root)
        expect(env.AZURE_STORAGE_CONNECTION_STRING).toContain(
          'BlobEndpoint=http://127.0.0.1:14888/devstoreaccount1'
        )
      } else if (provider === 'gcp') {
        expect(env.CLOUDSDK_CONFIG).toContain(root)
        expect(env.CLOUDSDK_AUTH_DISABLE_CREDENTIALS).toBe('true')
        expect(env.STORAGE_EMULATOR_HOST).toBe('http://127.0.0.1:14888')
        expect(env.PUBSUB_EMULATOR_HOST).toBe('127.0.0.1:14888')
        expect(env.CLOUDSDK_API_ENDPOINT_OVERRIDES_STORAGE).toBe('http://127.0.0.1:14888/')
      } else {
        expect(env.OCI_CLI_CONFIG_FILE).toContain(root)
        expect(env.OCI_CLI_RC_FILE).toContain(root)
        expect(env.FLOCI_OCI_ENDPOINT).toBe('http://127.0.0.1:14888')
        expect(env).not.toHaveProperty('OCI_CLI_AUTH', 'instance_principal')
      }
      expect(files(root)).not.toMatch(
        /BEGIN .*PRIVATE KEY|AccountKey=|client_secret|access_token|refresh_token/
      )
    }
  )
})
