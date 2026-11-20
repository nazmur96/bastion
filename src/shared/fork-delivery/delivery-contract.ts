import { z } from 'zod'

/**
 * Fork: Step 11 delivery evidence. Every link of revision → CI → artifact → registry → config →
 * controller → running pods is read from its real source and reported as verified, mismatch or
 * unknown. Nothing is inferred from a green badge.
 */
const relativePath = z
  .string()
  .max(256)
  .regex(/^[A-Za-z0-9_-][A-Za-z0-9._-]*(?:\/[A-Za-z0-9_-][A-Za-z0-9._-]*){0,8}$/)
  .refine((value) => value.split('/').every((part) => part !== '..'))
const kubeName = z.string().regex(/^[a-z0-9]([-a-z0-9]{0,61}[a-z0-9])?$/)
export const deliveryConfigSchema = z
  .object({
    projectId: z.string().min(1).max(4096),
    /** owner/name on GitHub. */
    repository: z.string().regex(/^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/),
    workflow: z.string().regex(/^[A-Za-z0-9._-]{1,100}\.ya?ml$/),
    /** The kustomization that pins the image digest. */
    configPath: relativePath.refine((value) => /kustomization\.ya?ml$/.test(value)),
    /** The image name entry in that kustomization's images list. */
    imageName: z.string().regex(/^[A-Za-z0-9._/-]{1,200}$/),
    application: kubeName,
    applicationNamespace: kubeName,
    /** A full commit SHA, or null for the current HEAD. */
    revision: z
      .string()
      .regex(/^[0-9a-f]{40}$/)
      .nullable()
  })
  .strict()
export type DeliveryConfig = z.infer<typeof deliveryConfigSchema>

export type DeliveryLinkId =
  | 'revision'
  | 'ci'
  | 'artifact'
  | 'registry'
  /** Step 14.9, only when the project has a supply-chain policy. */
  | 'signature'
  | 'sbom'
  | 'config'
  | 'controller'
  | 'running'
export type DeliveryLink = {
  id: DeliveryLinkId
  status: 'verified' | 'mismatch' | 'unknown'
  /** Short, fixed-shape evidence: a SHA, digest, run conclusion or reason. */
  detail: string
  /** Where the evidence came from, for example "GitHub Actions run 123". */
  source: string
}
export type DeliveryChain = {
  revision: string | null
  digest: string | null
  links: DeliveryLink[]
  /** Promotion needs CI, artifact and registry verified for this revision. */
  promotable: boolean
  /** The first link that blocks promotion, if any. */
  blockedBy: DeliveryLinkId | null
  /** The digest the deployment config pins now, and that file's fingerprint. */
  configDigest: string | null
  configFingerprint: string | null
  readAt: number
}
export const deliveryPromoteSchema = deliveryConfigSchema
  .extend({
    digest: z.string().regex(/^sha256:[0-9a-f]{64}$/),
    configFingerprint: z.string().regex(/^sha256:[0-9a-f]{64}$/)
  })
  .strict()
export type DeliveryResult<T> = ({ ok: true } & T) | { ok: false; code: string; message: string }
export type DeliveryApi = {
  chain: (config: DeliveryConfig) => Promise<DeliveryResult<{ chain: DeliveryChain }>>
  promote: (
    request: z.infer<typeof deliveryPromoteSchema>
  ) => Promise<DeliveryResult<{ path: string; from: string | null; to: string }>>
}
