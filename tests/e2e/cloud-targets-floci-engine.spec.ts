import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { build } from 'esbuild'
import { runProcess } from '@orca/process-host'

test('FL-03/04 direct lifecycle on a disposable engine', async ({ playwright }, testInfo) => {
  expect(playwright).toBeDefined()
  test.skip(process.env.ORCA_E2E_FLOCI_ENGINE !== '1', 'Opt-in disposable Docker engine proof')
  test.setTimeout(600000)
  const directory = await mkdtemp(join(tmpdir(), 'floci-engine-proof-'))
  const name = `bastion-floci-proof-${randomUUID()}`
  async function docker(args: string[], timeoutMs = 30000) {
    const result = await runProcess({
      program: 'docker',
      args,
      timeoutMs,
      maxOutputBytes: 4 * 1024 * 1024
    })
    expect(result.code, result.stderr).toBe(0)
    return result.stdout
  }
  try {
    await build({
      entryPoints: ['tests/e2e/fixtures/floci/lifecycle-proof.ts'],
      outfile: join(directory, 'proof.cjs'),
      bundle: true,
      platform: 'node',
      target: 'node24',
      format: 'cjs'
    })
    // Only this disposable daemon needs privilege; the production emulator never receives it.
    await docker([
      'run',
      '-d',
      '--privileged',
      '--name',
      name,
      process.env.ORCA_E2E_FLOCI_ENGINE_IMAGE ?? 'bastion-floci-proof-engine:local'
    ])
    await expect
      .poll(
        async () =>
          (
            await runProcess({
              program: 'docker',
              args: ['exec', name, 'docker', 'info'],
              timeoutMs: 5000
            })
          ).code,
        { timeout: 30000 }
      )
      .toBe(0)
    await docker(['cp', join(directory, 'proof.cjs'), `${name}:/proof.cjs`])
    const output = await docker(['exec', name, 'node', '/proof.cjs'], 500000)
    console.log(output)
    await testInfo.attach('lifecycle-proof', { body: output, contentType: 'text/plain' })
    expect(output).toContain('"nonLoopbackRefused":true')
    expect(output).toContain('"listersAgainstEmulator":true')
    expect(output).toContain('CLEANUP containers=0')
  } finally {
    await docker(['rm', '-fv', name])
    await rm(directory, { recursive: true, force: true })
  }
})
