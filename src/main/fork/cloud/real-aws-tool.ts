import { createHash } from 'node:crypto'
import { lstatSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join, relative } from 'node:path'
import { parse } from 'smol-toml'
import { runProcess } from '@orca/process-host'
import { RealAwsFailure } from '../../../shared/fork-cloud/real-aws-contract'
import { realAwsProfileEnv } from './real-aws-env'
export type RealAwsTool = {
  executable: string
  version: string
  fingerprint: string
  assertCurrent(): void
}
function hash(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}
function pin(root: string): { version: string; fingerprint: string } {
  const path = join(root, 'mise.toml'),
    stat = lstatSync(path)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 65536) {
    throw new RealAwsFailure('tool-unavailable')
  }
  try {
    lstatSync(join(root, 'devenv.nix'))
    throw new RealAwsFailure('tool-unavailable')
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
      throw error
    }
  }
  const config = parse(readFileSync(path, 'utf8'))
  const tools = config.tools
  if (!tools || typeof tools !== 'object' || Array.isArray(tools)) {
    throw new RealAwsFailure('tool-unavailable')
  }
  const pins = Object.entries(tools).filter(
    ([name]) => name === 'aws-cli' || name === 'aqua:aws/aws-cli'
  )
  if (pins.length !== 1) {
    throw new RealAwsFailure('tool-unavailable')
  }
  const value = pins[0][1]
  const table =
    value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)
      ? value
      : null
  if (
    table &&
    (Object.keys(table).some((key) => !['version', 'symlink_bins'].includes(key)) ||
      ('symlink_bins' in table && !['true', 'false', true, false].includes(table.symlink_bins)))
  ) {
    throw new RealAwsFailure('tool-unavailable')
  }
  const version = table ? table.version : value
  if (typeof version !== 'string' || !/^2\.(?:3[2-9]|[4-9]\d|[1-9]\d{2,})\.\d+$/.test(version)) {
    throw new RealAwsFailure('tool-unavailable')
  }
  return { version, fingerprint: hash(JSON.stringify(pins)) }
}
export function ownerMiseDataDir(
  owner: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform
): string {
  const home = platform === 'win32' ? (owner.USERPROFILE ?? homedir()) : (owner.HOME ?? homedir())
  const dir =
    owner.MISE_DATA_DIR ??
    (owner.XDG_DATA_HOME
      ? join(owner.XDG_DATA_HOME, 'mise')
      : platform === 'win32'
        ? join(owner.LOCALAPPDATA ?? join(home, 'AppData', 'Local'), 'mise')
        : join(home, '.local', 'share', 'mise'))
  if (!isAbsolute(dir)) {
    throw new RealAwsFailure('tool-unavailable')
  }
  return dir
}
export async function resolveRealAwsTool(
  root: string,
  owner: NodeJS.ProcessEnv = process.env
): Promise<RealAwsTool> {
  try {
    const declared = pin(root),
      data = ownerMiseDataDir(owner)
    const install = join(data, 'installs', 'aws-cli', declared.version)
    if (!lstatSync(install).isDirectory() || lstatSync(install).isSymbolicLink()) {
      throw new RealAwsFailure('tool-unavailable')
    }
    const canonical = realpathSync(install)
    let executable: string | undefined
    let entry: string | undefined
    const names =
      process.platform === 'win32'
        ? ['bin/aws.exe', 'aws.exe', 'aws/dist/aws.exe']
        : ['bin/aws', 'aws/dist/aws', 'aws']
    for (const name of names) {
      try {
        const path = realpathSync(join(install, name)),
          inside = relative(canonical, path)
        if (
          !inside ||
          inside.startsWith('..') ||
          isAbsolute(inside) ||
          !statSync(path).isFile() ||
          statSync(path).size > 128 * 1024 * 1024
        ) {
          continue
        }
        entry = join(install, name)
        executable = path
        break
      } catch {
        continue
      }
    }
    if (!executable) {
      throw new RealAwsFailure('tool-unavailable')
    }
    const admitted = executable,
      fingerprint = hash(readFileSync(admitted))
    const assertCurrent = () => {
      try {
        if (
          pin(root).fingerprint !== declared.fingerprint ||
          !entry ||
          realpathSync(entry) !== admitted ||
          realpathSync(install) !== canonical ||
          realpathSync(admitted) !== admitted ||
          hash(readFileSync(admitted)) !== fingerprint
        ) {
          throw new Error('changed')
        }
      } catch {
        throw new RealAwsFailure('tool-unavailable')
      }
    }
    const version = await runProcess({
      program: admitted,
      args: ['--version'],
      cwd: root,
      env: realAwsProfileEnv('default', 'us-east-1', owner),
      timeoutMs: 5000,
      maxOutputBytes: 4096,
      killOnOutputLimit: true
    })
    if (
      version.code !== 0 ||
      version.timedOut ||
      version.outputTruncated ||
      !`${version.stdout}\n${version.stderr}`.trim().startsWith(`aws-cli/${declared.version} `)
    ) {
      throw new RealAwsFailure('tool-unavailable')
    }
    assertCurrent()
    return { executable: admitted, version: declared.version, fingerprint, assertCurrent }
  } catch {
    throw new RealAwsFailure('tool-unavailable')
  }
}
