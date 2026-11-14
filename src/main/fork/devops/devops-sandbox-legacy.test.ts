import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({ userData: '', spawn: vi.fn() }))
vi.mock('../../../shared/app-environment', () => ({
  getAppEnvironment: () => ({ getPath: () => m.userData })
}))
vi.mock('node:child_process', async (load) => ({
  ...(await load<Record<string, unknown>>()),
  spawn: m.spawn,
  execFile: m.spawn
}))
m.userData = mkdtempSync(join(tmpdir(), 'legacy-sandbox-'))
afterAll(() => rmSync(m.userData, { recursive: true, force: true }))

describe('legacy machine-wide Floci sandbox', () => {
  it('drops stored AWS endpoints and credentials, keeps cluster state, and refuses path-only AWS', async () => {
    writeFileSync(
      join(m.userData, 'fork-devops-sandbox.json'),
      JSON.stringify({
        '/work/app': {
          awsEnv: { AWS_ENDPOINT_URL: 'http://localhost:4566', AWS_SECRET_ACCESS_KEY: 'LEGACY' },
          cluster: { name: 'app-dev', context: 'vcluster-docker_app-dev', paused: false }
        },
        '/work/other': { awsEnv: { AWS_ACCESS_KEY_ID: 'LEGACY' } }
      })
    )
    writeFileSync(join(m.userData, 'fork-floci-aws-config'), '[default]\n')
    const { readDevopsSandbox, runDevopsSandbox } = await import('./devops-sandbox')
    expect(readDevopsSandbox('/work/app')).toEqual({
      cluster: { name: 'app-dev', context: 'vcluster-docker_app-dev', paused: false }
    })
    expect(readDevopsSandbox('/work/other')).toEqual({})
    const stored = readFileSync(join(m.userData, 'fork-devops-sandbox.json'), 'utf8')
    expect(stored).not.toMatch(/awsEnv|LEGACY|4566/)
    if (process.platform !== 'win32') {
      expect(statSync(join(m.userData, 'fork-devops-sandbox.json')).mode & 0o777).toBe(0o600)
    }
    expect(existsSync(join(m.userData, 'fork-floci-aws-config'))).toBe(false)
    const result = await runDevopsSandbox('/work/app', 'aws', 'start')
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('Open Cloud') })
    expect(m.spawn).not.toHaveBeenCalled()
  })
})
