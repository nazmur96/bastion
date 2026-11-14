import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, symlinkSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { flociEngineConnection, privateFlociDirectory } from './floci-paths'
const roots: string[] = []
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'floci-private-'))
  roots.push(root)
  return root
}
afterEach(() => {
  vi.unstubAllEnvs()
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})
it('passes only a closed engine environment and an empty registry auth configuration', () => {
  for (const key of [
    'AWS_PROFILE',
    'AWS_CONFIG_FILE',
    'AWS_ACCESS_KEY_ID',
    'AWS_SECRET_ACCESS_KEY',
    'HTTP_PROXY',
    'DOCKER_HOST',
    'DOCKER_CONTEXT',
    'DOCKER_AUTH_CONFIG',
    'REGISTRY_AUTH_FILE',
    'CONTAINERS_CONF'
  ]) {
    vi.stubEnv(key, 'PLANTED_PRIVATE_MARKER')
  }
  const connection = flociEngineConnection(fixture(), 'docker')
  expect(JSON.stringify(connection)).not.toContain('PLANTED_PRIVATE_MARKER')
  expect(connection.env.MISE_AUTO_INSTALL).toBe('0')
  expect(readFileSync(join(connection.cwd, 'config.json'), 'utf8')).toBe('{"auths":{}}\n')
})
it('refuses a nonlocal owner-engine connection without consulting ambient contexts', () => {
  const root = fixture()
  mkdirSync(join(root, 'bastion-cloud'))
  writeFileSync(
    join(root, 'bastion-cloud', 'engine-connections.json'),
    '{"docker":"tcp://example.invalid:2375"}'
  )
  expect(() => flociEngineConnection(root, 'docker')).toThrow('unavailable')
})
it.skipIf(process.platform === 'win32')(
  'refuses dangling private paths and linked registry configuration',
  () => {
    const root = fixture(),
      dangling = join(root, 'dangling')
    symlinkSync(join(root, 'missing'), dangling)
    expect(() => privateFlociDirectory(dangling)).toThrow('stored')
    const connection = flociEngineConnection(root, 'docker'),
      settings = join(connection.cwd, 'config.json')
    rmSync(settings)
    const foreign = join(root, 'foreign')
    writeFileSync(foreign, 'unchanged')
    symlinkSync(foreign, settings)
    expect(() => flociEngineConnection(root, 'docker')).toThrow('stored')
    expect(readFileSync(foreign, 'utf8')).toBe('unchanged')
  }
)
