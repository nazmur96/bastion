import { execFile } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { expect, test } from '@playwright/test'

const execute = promisify(execFile)
const captureDirectory = process.env.ORCA_FLOCI_SPIKE_CAPTURE_DIR
const awsImage = 'public.ecr.aws/aws-cli/aws-cli:2.40.0'

function redact(value: unknown, key = ''): unknown {
  if (/secret|token|password|access.?key|connection.?string|private.?key/i.test(key)) {
    return '<redacted>'
  }
  if (Array.isArray(value)) {
    return value.map((item) => redact(item))
  }
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([name, item]) => [name, redact(item, name)])
    )
  }
  return value
}

async function capture(name: string, args: string[], command = 'docker', env = process.env) {
  const result = await execute(command, args, { timeout: 60_000, maxBuffer: 2_000_000, env }).then(
    ({ stdout, stderr }) => ({ exit: 0, stdout, stderr }),
    (error: unknown) => {
      if (!(error instanceof Error)) {
        throw error
      }
      const exit = 'code' in error && typeof error.code === 'number' ? error.code : -1
      const stdout = 'stdout' in error && typeof error.stdout === 'string' ? error.stdout : ''
      const stderr =
        'stderr' in error && typeof error.stderr === 'string' ? error.stderr : error.message
      return { exit, stdout, stderr }
    }
  )
  let output: unknown = result.stdout
  try {
    output = JSON.parse(result.stdout)
  } catch {
    if (args.includes('env')) {
      throw new Error('Refusing to capture non-JSON emulator environment output')
    }
    // CLI refusals may be plain text even with --json.
  }
  if (captureDirectory) {
    await mkdir(captureDirectory, { recursive: true })
    await writeFile(
      path.join(captureDirectory, `${name}.json`),
      `${JSON.stringify({ capturedAt: new Date().toISOString(), argv: [command, ...args], ...result, stdout: redact(output), redactions: 'Credential-shaped JSON fields removed before writing.' }, null, 2)}\n`
    )
  }
  return result
}

function floci(product: string, command: string, container: string, port: number) {
  return [
    product,
    command,
    '--container',
    container,
    '--endpoint',
    `http://localhost:${port}`,
    '--json'
  ]
}

function aws(port: number, ...operation: string[]) {
  return [
    'run',
    '--rm',
    '--network',
    'host',
    '--label',
    'bastion.validation=step9-spike-aws',
    awsImage,
    '--endpoint-url',
    `http://localhost:${port}`,
    '--region',
    'us-east-1',
    '--no-sign-request',
    ...operation,
    '--output',
    'json'
  ]
}

test.describe('9.0 disposable Floci spike', () => {
  test.beforeEach(async () => {
    const available = await execute('floci', ['--version'], {
      timeout: 10_000,
      env: { ...process.env, MISE_AUTO_INSTALL: '0' }
    }).then(
      () => true,
      () => false
    )
    test.skip(
      !available,
      'Requires floci on PATH from a dev shell or managed project; never installs tools.'
    )
  })
  test.skip(
    process.env.ORCA_FLOCI_SPIKE !== '1',
    'Requires explicitly provisioned disposable emulators; see fixture README.'
  )

  test('captures ready-state CLI output for all four products', async () => {
    for (const [product, container, port] of [
      ['aws', 'bastion-step9-alpha', 14566],
      ['az', 'bastion-step9-az', 14577],
      ['gcp', 'bastion-step9-gcp', 14588],
      ['oci', 'bastion-step9-oci', 14599]
    ] as const) {
      for (const command of ['status', 'env', 'services']) {
        const result = await capture(
          `${product}-${command}`,
          floci(product, command, container, port),
          'floci'
        )
        expect(result.exit, `${product} ${command}: ${result.stderr}`).toBe(0)
        expect(() => JSON.parse(result.stdout)).not.toThrow()
      }
    }
    const version = await capture(
      'aws-version',
      floci('aws', 'version', 'bastion-step9-alpha', 14566),
      'floci'
    )
    expect(version.exit, version.stderr).toBe(0)
  })

  test('records AWS listing support and proves two live instances isolate resource names', async () => {
    for (const [name, operation] of [
      ['tagging', ['resourcegroupstaggingapi', 'get-resources']],
      ['s3', ['s3api', 'list-buckets']],
      ['dynamodb', ['dynamodb', 'list-tables']],
      ['sqs', ['sqs', 'list-queues']],
      ['lambda', ['lambda', 'list-functions']]
    ] as const) {
      const result = await capture(`aws-list-${name}`, aws(14566, ...operation))
      expect(result.exit, `${name}: ${result.stderr}`).toBe(0)
    }
    const bucket = `bastion-spike-${Date.now()}`
    try {
      expect(
        (
          await capture(
            'isolation-create-alpha',
            aws(14566, 's3api', 'create-bucket', '--bucket', bucket)
          )
        ).exit
      ).toBe(0)
      const alpha = await capture('isolation-alpha', aws(14566, 's3api', 'list-buckets'))
      const beta = await capture('isolation-beta', aws(24566, 's3api', 'list-buckets'))
      expect(alpha.exit).toBe(0)
      expect(beta.exit).toBe(0)
      expect(alpha.stdout).toContain(bucket)
      expect(beta.stdout).not.toContain(bucket)
      const inventory = await capture('isolation-containers', [
        'inspect',
        'bastion-step9-alpha',
        'bastion-step9-beta',
        '--format',
        '{{json .NetworkSettings.Ports}}'
      ])
      expect(inventory.exit).toBe(0)
      expect(inventory.stdout).toContain('14566')
      expect(inventory.stdout).toContain('24566')
    } finally {
      expect(
        (
          await capture(
            'isolation-delete-alpha',
            aws(14566, 's3api', 'delete-bucket', '--bucket', bucket)
          )
        ).exit
      ).toBe(0)
    }
  })

  test('captures the explicitly configured Podman socket result', async () => {
    test.skip(
      process.env.ORCA_FLOCI_SPIKE_PODMAN !== '1',
      'Requires a separately provisioned Podman instance.'
    )
    const result = await capture(
      'podman-rootful-status',
      floci('aws', 'status', 'bastion-step9-podman-rootful', 34566),
      'floci',
      { ...process.env, DOCKER_HOST: process.env.ORCA_FLOCI_SPIKE_PODMAN_SOCKET }
    )
    expect(result.exit, result.stderr).toBe(0)
    expect(JSON.parse(result.stdout)).toHaveProperty('reachable', true)
  })
})
