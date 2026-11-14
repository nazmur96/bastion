import mobyProfile from './seccomp/moby-default.json'
import { chmodSync, lstatSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { FlociFailure } from '../../../shared/fork-cloud/floci-contract'

// The pinned native server answers accepted sockets using write/writev, without outbound clients.
const outboundCalls = new Set(['connect', 'sendto', 'sendmsg', 'sendmmsg', 'socketcall'])
export const FLOCI_NETWORK_POLICY = {
  ...mobyProfile,
  syscalls: [
    ...mobyProfile.syscalls
      .map((rule) => ({ ...rule, names: rule.names.filter((name) => !outboundCalls.has(name)) }))
      .filter((rule) => rule.names.length > 0),
    { names: ['connect'], action: 'SCMP_ACT_ERRNO', errnoRet: 2 }
  ]
}
export function flociPolicyPath(dataPath: string, targetId: string): string {
  return join(dirname(dataPath), `${targetId}.seccomp.json`)
}
export function writeFlociNetworkPolicy(dataPath: string, targetId: string): void {
  const path = flociPolicyPath(dataPath, targetId)
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
  writeFileSync(path, JSON.stringify(FLOCI_NETWORK_POLICY), { mode: 0o600 })
  if (process.platform !== 'win32') {
    chmodSync(path, 0o600)
  }
}
export function hasFlociNetworkPolicy(options: string[]): boolean {
  const profile = options.find((option) => option.startsWith('seccomp='))
  try {
    return Boolean(
      profile &&
      JSON.stringify(JSON.parse(profile.slice(8))) === JSON.stringify(FLOCI_NETWORK_POLICY)
    )
  } catch {
    return false
  }
}
