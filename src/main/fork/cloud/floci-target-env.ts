import { chmodSync, lstatSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { FlociFailure, type FlociInstance } from '../../../shared/fork-cloud/floci-contract'
import { privateFlociDirectory } from './floci-paths'

// The pinned image's emulated region; its account is synthetic and never a real one.
export const FLOCI_REGION = 'us-east-1'

// Ambient routes to real credentials. Empty values disable them in the AWS CLI and SDKs, so a
// shell that inherited a real session cannot pair it with the emulator endpoint.
const NEUTRALIZED = [
  'AWS_SESSION_TOKEN',
  'AWS_SECURITY_TOKEN',
  'AWS_WEB_IDENTITY_TOKEN_FILE',
  'AWS_ROLE_ARN',
  'AWS_ROLE_SESSION_NAME',
  'AWS_CONTAINER_CREDENTIALS_FULL_URI',
  'AWS_CONTAINER_CREDENTIALS_RELATIVE_URI',
  'AWS_CONTAINER_AUTHORIZATION_TOKEN',
  'AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE'
] as const

function sealedConfigPath(root: string, targetId: string): string {
  const control = join(root, 'bastion-cloud', 'control')
  privateFlociDirectory(control)
  const path = join(control, `${targetId}.aws-config`)
  try {
    const stat = lstatSync(path)
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new FlociFailure('storage')
    }
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
      throw error
    }
  }
  // A bare default profile: the engineer's real profiles, SSO caches and credential_process
  // entries are never read for an emulated target.
  writeFileSync(path, '[default]\n', { mode: 0o600 })
  if (process.platform !== 'win32') {
    chmodSync(path, 0o600)
  }
  return path
}

/**
 * Environment for a process that should reach this ready emulator and nothing else. Dummy
 * credentials are the emulator's documented test values, kept in memory only.
 */
export function flociTargetEnv(
  root: string,
  instance: FlociInstance,
  inheritedNoProxy = process.env.NO_PROXY ?? process.env.no_proxy ?? ''
): Record<string, string> {
  if (instance.state !== 'ready') {
    throw new FlociFailure('not-ready')
  }
  const config = sealedConfigPath(root, instance.targetId)
  const noProxy = [...new Set([...inheritedNoProxy.split(','), '127.0.0.1', 'localhost'])]
    .map((entry) => entry.trim())
    .filter(Boolean)
    .join(',')
  return {
    ...Object.fromEntries(NEUTRALIZED.map((name) => [name, ''])),
    AWS_ENDPOINT_URL: `http://127.0.0.1:${instance.port}`,
    AWS_ACCESS_KEY_ID: 'test',
    AWS_SECRET_ACCESS_KEY: 'test',
    AWS_REGION: FLOCI_REGION,
    AWS_DEFAULT_REGION: FLOCI_REGION,
    AWS_PROFILE: 'default',
    AWS_DEFAULT_PROFILE: 'default',
    AWS_CONFIG_FILE: config,
    AWS_SHARED_CREDENTIALS_FILE: config,
    AWS_EC2_METADATA_DISABLED: 'true',
    NO_PROXY: noProxy,
    no_proxy: noProxy
  }
}
