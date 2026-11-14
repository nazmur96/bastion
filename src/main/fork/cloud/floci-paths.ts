import { chmodSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { userInfo } from 'node:os'
import { z } from 'zod'
import { FlociFailure } from '../../../shared/fork-cloud/floci-contract'
import { engineRunner, type EngineConnection } from './floci-engine'
function entry(path: string) {
  try {
    return lstatSync(path)
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return undefined
    }
    throw error
  }
}
export function privateFlociDirectory(path: string): void {
  if (entry(path) && (!lstatSync(path).isDirectory() || lstatSync(path).isSymbolicLink())) {
    throw new FlociFailure('storage')
  }
  mkdirSync(path, { recursive: true, mode: 0o700 })
  if (process.platform !== 'win32') {
    chmodSync(path, 0o700)
  }
}
export function flociEngineConnection(root: string, engine: 'docker' | 'podman'): EngineConnection {
  const control = join(root, 'bastion-cloud', 'control')
  privateFlociDirectory(control)
  const home = join(control, engine)
  privateFlociDirectory(home)
  const config = join(root, 'bastion-cloud', 'engine-connections.json')
  let endpoint =
    engine === 'docker'
      ? process.platform === 'win32'
        ? 'npipe:////./pipe/docker_engine'
        : 'unix:///var/run/docker.sock'
      : `unix:///run/user/${userInfo().uid}/podman/podman.sock`
  if (entry(config)) {
    const stat = lstatSync(config)
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16384) {
      throw new FlociFailure('storage')
    }
    const parsed = z
      .object({ docker: z.string().optional(), podman: z.string().optional() })
      .strict()
      .parse(JSON.parse(readFileSync(config, 'utf8')))
    endpoint = parsed[engine] ?? endpoint
  } else if (engine === 'podman' && process.platform !== 'linux') {
    throw new FlociFailure('engine-unavailable')
  }
  if (
    !/^unix:\/\/\/[^\0\r\n]+$/.test(endpoint) &&
    !/^npipe:\/\/\/\/\.\/pipe\/[a-zA-Z0-9_-]+$/.test(endpoint)
  ) {
    throw new FlociFailure('engine-unavailable')
  }
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    HOME: home,
    USERPROFILE: home,
    DOCKER_CONFIG: home,
    MISE_AUTO_INSTALL: '0'
  }
  for (const name of [
    'SystemRoot',
    'SystemDrive',
    'WINDIR',
    'PATHEXT',
    'TMP',
    'TEMP',
    'TMPDIR',
    'LD_LIBRARY_PATH',
    'NIX_LD',
    'NIX_LD_LIBRARY_PATH'
  ]) {
    if (process.env[name]) {
      env[name] = process.env[name]
    }
  }
  const settings = join(home, 'config.json')
  if (entry(settings) && (!lstatSync(settings).isFile() || lstatSync(settings).isSymbolicLink())) {
    throw new FlociFailure('storage')
  }
  if (entry(settings) && process.platform !== 'win32') {
    chmodSync(settings, 0o600)
  }
  writeFileSync(settings, '{"auths":{}}\n', { mode: 0o600 })
  return { program: engine, endpoint, env, cwd: home }
}
export function ownerEngineRunner(root: string, engine: 'docker' | 'podman') {
  return engineRunner(flociEngineConnection(root, engine))
}
