import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { FlociInstance } from '../../../shared/fork-cloud/floci-contract'
import { flociTargetEnv } from './floci-target-env'
import { resolveFlociEnv, setFlociEnvResolver } from './floci-env-authority'

const roots: string[] = []
function root(): string {
  const path = mkdtempSync(join(tmpdir(), 'floci-env-'))
  roots.push(path)
  return path
}
afterEach(() => {
  setFlociEnvResolver(undefined)
  for (const path of roots.splice(0)) {
    rmSync(path, { recursive: true, force: true })
  }
})
const targetId = '3f2b8c1e-0a1d-4c4e-9a37-1b2c3d4e5f60'
function instance(state: FlociInstance['state']): FlociInstance {
  return {
    id: '9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d',
    namespaceId: 'workspace-test',
    targetId,
    name: 'bastion-test',
    network: 'bastion-test-net',
    port: 14566,
    dataPath: '/unused',
    engine: 'docker',
    engineId: 'engine',
    containerId: 'container',
    imageId: null,
    epoch: 1,
    state,
    code: 'complete',
    operationId: null,
    operationPid: null
  }
}

describe('Floci target environment', () => {
  it('points only at the ready instance and neutralizes ambient real credentials', () => {
    const r = root()
    const env = flociTargetEnv(r, instance('ready'), 'corp.example,10.0.0.1')
    expect(env.AWS_ENDPOINT_URL).toBe('http://127.0.0.1:14566')
    expect(env).toMatchObject({
      AWS_ACCESS_KEY_ID: 'test',
      AWS_SECRET_ACCESS_KEY: 'test',
      AWS_SESSION_TOKEN: '',
      AWS_WEB_IDENTITY_TOKEN_FILE: '',
      AWS_CONTAINER_CREDENTIALS_FULL_URI: '',
      AWS_EC2_METADATA_DISABLED: 'true',
      AWS_PROFILE: 'default'
    })
    expect(env.NO_PROXY.split(',')).toEqual(['corp.example', '10.0.0.1', '127.0.0.1', 'localhost'])
    // A bare default profile: real profiles, SSO and credential_process are never read.
    expect(readFileSync(env.AWS_CONFIG_FILE, 'utf8')).toBe('[default]\n')
    expect(env.AWS_SHARED_CREDENTIALS_FILE).toBe(env.AWS_CONFIG_FILE)
    if (process.platform !== 'win32') {
      expect(statSync(env.AWS_CONFIG_FILE).mode & 0o777).toBe(0o600)
    }
  })

  it('refuses an instance that is not ready', () => {
    for (const state of ['not-started', 'starting', 'stopped', 'unknown'] as const) {
      expect(() => flociTargetEnv(root(), instance(state))).toThrow('readiness')
    }
  })

  it.skipIf(process.platform === 'win32')('never writes through a symlinked config file', () => {
    const r = root()
    const outside = join(r, 'outside')
    writeFileSync(outside, 'keep')
    mkdirSync(join(r, 'bastion-cloud', 'control'), { recursive: true })
    symlinkSync(outside, join(r, 'bastion-cloud', 'control', `${targetId}.aws-config`))
    expect(() => flociTargetEnv(r, instance('ready'))).toThrow()
    expect(readFileSync(outside, 'utf8')).toBe('keep')
  })
})

describe('Floci environment authority', () => {
  it('adds nothing without a target and refuses a malformed or unresolvable one', async () => {
    expect(await resolveFlociEnv(undefined)).toEqual({})
    await expect(resolveFlociEnv({ projectId: 'p', targetId: 'not-a-uuid' })).rejects.toThrow(
      'Invalid emulator request'
    )
    await expect(resolveFlociEnv({ projectId: 'p', targetId })).rejects.toThrow(
      'execution owner changed'
    )
    setFlociEnvResolver(async () => ({ AWS_ENDPOINT_URL: 'http://127.0.0.1:14566' }))
    expect(await resolveFlociEnv({ projectId: 'p', targetId })).toEqual({
      AWS_ENDPOINT_URL: 'http://127.0.0.1:14566'
    })
  })
})
