import { z } from 'zod'
const text = z.string().min(1).max(4096)
export const cloudBindingSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('none') }).strict(),
  z
    .object({
      kind: z.literal('emulated-aws'),
      namespaceId: text,
      projectId: text,
      targetId: z.string().uuid(),
      selectionGeneration: z.number().int().nonnegative(),
      configRevision: z.number().int().nonnegative(),
      policyFingerprint: z.string().regex(/^sha256:[a-f0-9]{64}$/),
      owner: z
        .object({
          projectId: text,
          root: text,
          hostId: z.literal('local'),
          routeKey: text,
          runtimeId: text,
          pairingRevision: text
        })
        .strict(),
      instance: z
        .object({
          id: z.string().uuid(),
          epoch: z.number().int().nonnegative(),
          engineId: text,
          containerId: z.string().nullable(),
          imageDigest: text,
          port: z.number().int().min(1024).max(65535),
          persistenceKey: z.string().uuid()
        })
        .strict()
    })
    .strict()
])
export type CloudBinding = z.infer<typeof cloudBindingSchema>
export type BoundCloud = Extract<CloudBinding, { kind: 'emulated-aws' }>
export function sameCloudBinding(
  a: CloudBinding | undefined,
  b: CloudBinding | undefined
): boolean {
  return JSON.stringify(a ?? { kind: 'none' }) === JSON.stringify(b ?? { kind: 'none' })
}
