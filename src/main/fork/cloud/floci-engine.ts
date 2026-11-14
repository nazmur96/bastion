import { flociPolicyPath } from './floci-network-policy'
import { z } from 'zod'
import { runProcess } from '@orca/process-host'
import {
  FLOCI_IMAGE,
  FlociFailure,
  flociMessages,
  type FlociCode
} from '../../../shared/fork-cloud/floci-contract'
export { FLOCI_IMAGE }
const manifestSchema = z
  .object({
    namespaceId: z.string().min(1),
    targetId: z.string().uuid(),
    id: z.string().uuid(),
    name: z.string().regex(/^bastion-[a-z0-9-]+$/),
    network: z.string().regex(/^bastion-[a-z0-9-]+$/),
    port: z.number().int().min(1024).max(65535),
    dataPath: z
      .string()
      .min(1)
      .refine((path) => !/[\n\r,]/.test(path) && !path.includes('\0'))
  })
  .strict()
export type EngineManifest = z.infer<typeof manifestSchema>
export function flociLabels(manifest: EngineManifest): string[] {
  return [
    '--label',
    `bastion.workspace=${manifest.namespaceId}`,
    '--label',
    `bastion.target=${manifest.targetId}`,
    '--label',
    `bastion.instance=${manifest.id}`
  ]
}
export function flociCreateArgs(raw: unknown): string[] {
  const m = manifestSchema.parse(raw)
  const user =
    typeof process.getuid === 'function'
      ? `${process.getuid()}:${process.getgid?.() ?? process.getuid()}`
      : '1001:1001'
  return [
    'create',
    '--name',
    m.name,
    ...flociLabels(m),
    '--network',
    m.network,
    '--publish',
    `127.0.0.1:${m.port}:4566/tcp`,
    '--mount',
    `type=bind,source=${m.dataPath},target=/app/data`,
    '--user',
    user,
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges',
    '--security-opt',
    `seccomp=${flociPolicyPath(m.dataPath, m.targetId)}`,
    '--no-healthcheck',
    '--read-only',
    '--tmpfs',
    '/tmp:rw,nosuid,nodev,size=128m',
    '--pids-limit',
    '256',
    '--memory',
    '768m',
    '--env',
    'FLOCI_STORAGE_MODE=persistent',
    '--env',
    'AWS_EC2_METADATA_DISABLED=true',
    '--entrypoint',
    '/app/application',
    FLOCI_IMAGE,
    '-Dquarkus.http.host=0.0.0.0',
    '-Dfloci.security.allow-unsafe-network-exposure=true'
  ]
}
export function classifyEngineFailure(stderr: string): { code: FlociCode; message: string } {
  const code = /policy\.json|signature policy/i.test(stderr)
    ? 'container-policy-missing'
    : /permission denied|access is denied/i.test(stderr)
      ? 'access-denied'
      : /port is already allocated|address already in use/i.test(stderr)
        ? 'port-conflict'
        : /manifest unknown|no matching manifest|pull access denied|image.*not found/i.test(stderr)
          ? 'image-unavailable'
          : 'engine-unavailable'
  return { code, message: flociMessages[code] }
}
export type EngineConnection = {
  program: 'docker' | 'podman'
  endpoint: string
  env: NodeJS.ProcessEnv
  cwd: string
}
export type EngineResult = {
  code: number | null
  stdout: string
  stderr: string
  timedOut: boolean
  outputTruncated?: boolean
}
export type EngineRunner = (args: string[]) => Promise<EngineResult>
export function engineRunner(connection: EngineConnection): EngineRunner {
  return (args) =>
    runProcess({
      program: connection.program,
      args: [
        ...(connection.program === 'podman'
          ? ['--remote', '--url', connection.endpoint]
          : ['--host', connection.endpoint]),
        ...args
      ],
      env: connection.env,
      cwd: connection.cwd,
      timeoutMs: args[0] === 'pull' ? 180000 : 30000,
      maxOutputBytes: 1024 * 1024,
      killOnOutputLimit: true
    })
}
export async function engineCall(run: EngineRunner, args: string[]): Promise<string> {
  const out = await run(args)
  if (out.code !== 0 || out.timedOut || out.outputTruncated) {
    throw new FlociFailure(classifyEngineFailure(out.stderr).code)
  }
  return out.stdout.trim()
}
export async function inspectContainer(run: EngineRunner, id: string): Promise<unknown> {
  const out = await run(['inspect', '--type', 'container', id])
  if (out.code !== 0 && /no such (?:object|container)|not found/i.test(out.stderr)) {
    return null
  }
  if (out.code !== 0 || out.timedOut || out.outputTruncated) {
    throw new FlociFailure(classifyEngineFailure(out.stderr).code)
  }
  const rows: unknown = JSON.parse(out.stdout)
  if (!Array.isArray(rows) || rows.length !== 1) {
    throw new FlociFailure('instance-conflict')
  }
  return rows[0]
}
