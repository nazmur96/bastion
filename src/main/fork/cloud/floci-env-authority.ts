import { z } from 'zod'
import { FlociFailure } from '../../../shared/fork-cloud/floci-contract'

export const cloudTargetRefSchema = z
  .object({ projectId: z.string().min(1).max(4096), targetId: z.string().uuid() })
  .strict()
export type CloudTargetRef = z.infer<typeof cloudTargetRefSchema>
type Resolver = (projectId: string, targetId: string) => Promise<Record<string, string>>
let resolver: Resolver | undefined

export function setFlociEnvResolver(next: Resolver | undefined): void {
  resolver = next
}

/**
 * Environment for a run bound to a selected emulated target, derived in main from the owner's
 * catalog. No target means no emulator environment; a target that cannot be resolved refuses the
 * run rather than letting it fall through to the engineer's real cloud configuration.
 */
export async function resolveFlociEnv(raw: unknown): Promise<Record<string, string>> {
  if (raw === undefined || raw === null) {
    return {}
  }
  const ref = cloudTargetRefSchema.safeParse(raw)
  if (!ref.success || !resolver) {
    throw new FlociFailure(ref.success ? 'owner-changed' : 'invalid')
  }
  return resolver(ref.data.projectId, ref.data.targetId)
}
