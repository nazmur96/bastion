import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import * as provider from './cloud-workspace-provider'

function capability(name: string) {
  const value: unknown = Reflect.get(provider, name)
  expect(value, `Missing 9.3a capability ${name}`).toBeTypeOf('function')
  if (typeof value !== 'function') {
    throw new Error('Missing controlled capability')
  }
  return (...args: unknown[]): unknown => Reflect.apply(value, undefined, args)
}
const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})
function fixture(pin = 'aws-cli = { version = "2.40.0", symlink_bins = "true" }') {
  const root = mkdtempSync(join(tmpdir(), 'real-aws-controlled-'))
  roots.push(root)
  const project = join(root, 'project'),
    data = join(root, 'mise'),
    shadow = join(root, 'shadow')
  for (const path of [project, shadow]) {
    mkdirSync(path)
  }
  writeFileSync(
    join(project, 'mise.toml'),
    `[tools]\n${pin}\n[env]\nAWS_PROFILE="PROJECT_PROFILE_MUST_NOT_RUN"\n`
  )
  const executable = join(data, 'installs', 'aws-cli', '2.40.0', 'bin', 'aws')
  mkdirSync(join(executable, '..'), { recursive: true })
  const log = join(root, 'calls.jsonl'),
    shadowLog = join(root, 'shadow-used')
  const script = `#!${process.execPath}\nconst fs=require('fs');const args=process.argv.slice(2);if(args.includes('--version')){console.log('aws-cli/2.40.0 fixture');process.exit(0)}fs.appendFileSync(${JSON.stringify(log)},JSON.stringify({args,env:process.env})+'\\n');console.log(JSON.stringify({Account:'000000000000',Arn:'arn:aws:iam::000000000000:user/fixture',UserId:'AIDA00000000000000000'}));\n`
  writeFileSync(executable, script, { mode: 0o700 })
  chmodSync(executable, 0o700)
  writeFileSync(
    join(shadow, 'aws'),
    `#!${process.execPath}\nrequire('fs').writeFileSync(${JSON.stringify(shadowLog)},'used');process.exit(1)\n`,
    { mode: 0o700 }
  )
  return {
    root,
    project,
    data,
    executable,
    log,
    shadowLog,
    env: { MISE_DATA_DIR: data, HOME: root, PATH: shadow }
  }
}
describe('9.3a controlled project tool and profile (no AWS)', () => {
  it('RA-02 accepts the inert table pin and resolves the installed executable despite a shadow host aws', async () => {
    const f = fixture()
    const tool = z
      .object({ executable: z.string(), version: z.string() })
      .parse(await capability('resolveRealAwsTool')(f.project, f.env))
    expect(tool).toMatchObject({ executable: f.executable, version: '2.40.0' })
    expect(existsSync(f.shadowLog)).toBe(false)
  })
  it.each([
    'aws-cli = "latest"',
    'aws-cli = {version="2.40.0", postinstall="false"}',
    'node = "24.0.0"'
  ])('RA-02 refuses unsupported/dynamic pin %s without host fallback', async (pin) => {
    const f = fixture(pin)
    await expect(capability('resolveRealAwsTool')(f.project, f.env)).rejects.toThrow()
    expect(existsSync(f.shadowLog)).toBe(false)
  })
  it('RA-02 refuses an installed executable symlink escaping its version directory', async () => {
    const f = fixture()
    rmSync(f.executable)
    symlinkSync(join(f.root, 'shadow', 'aws'), f.executable)
    await expect(capability('resolveRealAwsTool')(f.project, f.env)).rejects.toThrow()
    expect(existsSync(f.shadowLog)).toBe(false)
  })
  it('RA-03 records the absolute CLI argv and only the admitted real-profile environment', async () => {
    const f = fixture()
    const tool = await capability('resolveRealAwsTool')(f.project, f.env)
    const env = capability('realAwsProfileEnv')('fixture-federated', 'us-east-1', {
      ...f.env,
      AWS_ENDPOINT_URL: 'PLANTED_FLOCI',
      AWS_ACCESS_KEY_ID: 'PLANTED_KEY',
      AWS_SESSION_TOKEN: 'PLANTED_SESSION',
      HTTPS_PROXY: 'https://proxy.invalid',
      AWS_CA_BUNDLE: '/fixture/ca.pem'
    })
    await capability('callRealAwsOperation')(tool, env, f.project, 'identity', {})
    const call = z
      .object({ args: z.array(z.string()), env: z.record(z.string(), z.string()) })
      .parse(JSON.parse(readFileSync(f.log, 'utf8').trim()))
    expect(call.args).toContain('get-caller-identity')
    expect(call.args).toContain('fixture-federated')
    expect(call.env).toMatchObject({
      AWS_PROFILE: 'fixture-federated',
      AWS_IGNORE_CONFIGURED_ENDPOINT_URLS: 'true',
      HTTPS_PROXY: 'https://proxy.invalid',
      AWS_CA_BUNDLE: '/fixture/ca.pem'
    })
    expect(JSON.stringify(call)).not.toMatch(
      /PLANTED_|PROJECT_PROFILE_MUST_NOT_RUN|--endpoint-url|--no-verify-ssl/
    )
    expect(existsSync(f.shadowLog)).toBe(false)
  })
  it('RA-04 refuses a non-allowlisted operation without starting the CLI', async () => {
    const f = fixture(),
      tool = await capability('resolveRealAwsTool')(f.project, f.env)
    await expect(
      capability('callRealAwsOperation')(tool, f.env, f.project, 'ec2:run-instances', {})
    ).rejects.toThrow()
    expect(existsSync(f.log)).toBe(false)
  })
})
describe('G5 classified failures', () => {
  it.each([
    [
      255,
      "aws: [ERROR]: Your session has expired. Please reauthenticate using 'aws login'.",
      'cli-session-expired'
    ],
    [255, 'Unrelated provider failure', 'cli-failed'],
    [
      254,
      'An error occurred (ExpiredToken) when calling the GetCallerIdentity operation',
      'service-token-expired'
    ],
    [
      255,
      'An error occurred (ExpiredTokenException) when calling the ListTables operation',
      'service-token-expired'
    ],
    [
      254,
      'An error occurred (AccessDeniedException) when calling the ListTables operation',
      'denied'
    ],
    [253, 'The config profile could not be found', 'auth-unavailable']
  ])('RA-05 classifies exit %s without exposing stderr', (code, stderr, expected) => {
    expect(capability('classifyRealAwsFailure')({ code, stderr })).toBe(expected)
  })
})
