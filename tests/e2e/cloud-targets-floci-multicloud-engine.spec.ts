import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { build } from 'esbuild'
import { runProcess } from '@orca/process-host'

test('MC-02 production multicloud lifecycle on the existing disposable-engine fixture', async ({
  playwright
}, info) => {
  expect(playwright).toBeDefined()
  test.skip(process.env.ORCA_E2E_FLOCI_ENGINE !== '1', 'Opt-in disposable Docker engine proof')
  test.skip(process.platform !== 'linux' || process.arch !== 'x64', 'Only linux/amd64 is proven')
  test.setTimeout(600000)
  const directory = await mkdtemp(join(tmpdir(), 'multicloud-engine-proof-'))
  const name = `bastion-multicloud-proof-${randomUUID()}`
  let id: string | undefined
  async function docker(args: string[], timeoutMs = 30000) {
    const result = await runProcess({
      program: 'docker',
      args,
      timeoutMs,
      maxOutputBytes: 8 * 1024 * 1024
    })
    expect(result.code, result.stderr).toBe(0)
    return result.stdout.trim()
  }
  try {
    await build({
      entryPoints: ['tests/e2e/fixtures/floci/multicloud-lifecycle-proof.ts'],
      outfile: join(directory, 'proof.cjs'),
      bundle: true,
      platform: 'node',
      target: 'node24',
      format: 'cjs'
    })
    // Use the already built 9.2 test daemon; never pull a mutable fixture tag.
    const image = JSON.parse(
      await docker([
        'image',
        'inspect',
        process.env.ORCA_E2E_FLOCI_ENGINE_IMAGE ?? 'bastion-floci-proof-engine:local'
      ])
    )[0].Id
    id = await docker(['create', '--privileged', '--name', name, image])
    await docker(['start', id])
    await expect
      .poll(
        async () =>
          (
            await runProcess({
              program: 'docker',
              args: ['exec', id ?? '', 'docker', 'info'],
              timeoutMs: 5000
            })
          ).code,
        { timeout: 30000 }
      )
      .toBe(0)
    await docker(['cp', join(directory, 'proof.cjs'), `${id}:/proof.cjs`])
    const output = await docker(['exec', id, 'node', '/proof.cjs'], 500000)
    console.log(output)
    await info.attach('multicloud-production-proof', { body: output, contentType: 'text/plain' })
    expect(output.match(/PRODUCTION_PROOF /g)).toHaveLength(3)
    expect(output).toContain('CLEANUP containers=0')
  } finally {
    if (id) {
      await docker(['rm', '-fv', id])
    }
    await rm(directory, { recursive: true, force: true })
  }
})
