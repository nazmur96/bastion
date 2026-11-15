import type { FlociProvider } from '../../../shared/fork-cloud/floci-products'
import { createHash } from 'node:crypto'
import { z } from 'zod'
import { FlociFailure, type FlociInstance } from '../../../shared/fork-cloud/floci-contract'
import { engineCall, type EngineRunner } from './floci-engine'
export async function flociEngineIdentity(
  run: EngineRunner,
  instance: FlociInstance,
  provider: FlociProvider = 'aws'
): Promise<string> {
  const info: unknown = JSON.parse(await engineCall(run, ['info', '--format', '{{json .}}']))
  if (provider !== 'aws') {
    const supported =
      instance.engine === 'docker'
        ? z
            .object({ OSType: z.literal('linux'), Architecture: z.enum(['amd64', 'x86_64']) })
            .safeParse(info).success
        : z
            .object({
              host: z.object({ os: z.literal('linux'), arch: z.enum(['amd64', 'x86_64']) })
            })
            .safeParse(info).success
    if (!supported) {
      throw new FlociFailure('image-unavailable')
    }
  }
  const docker = z.object({ ID: z.string().min(1) }).safeParse(info)
  const podman = z
    .object({
      host: z.object({
        hostname: z.string().min(1),
        security: z.object({ rootless: z.literal(true) })
      }),
      store: z.object({ graphRoot: z.string().min(1), runRoot: z.string().min(1) })
    })
    .safeParse(info)
  const identity =
    instance.engine === 'docker' && docker.success
      ? docker.data.ID
      : instance.engine === 'podman' && podman.success
        ? JSON.stringify(podman.data)
        : null
  if (!identity) {
    throw new FlociFailure('engine-unavailable')
  }
  const id = createHash('sha256')
    .update(JSON.stringify([instance.engine, identity]))
    .digest('hex')
  if (instance.engineId !== `unobserved:${instance.engine}` && id !== instance.engineId) {
    throw new FlociFailure('instance-conflict')
  }
  return id
}
