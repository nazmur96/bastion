import type {
  RealAwsResult,
  RealAwsIdentity,
  RealAwsResources,
  RealAwsBudgets,
  RealAwsCostChallenge,
  RealAwsCostGrant,
  RealAwsCostView
} from './real-aws-contract'
import type { FlociAction, FlociResult } from './floci-contract'
import type { CloudBinding } from './cloud-binding'
import type { FlociResourcesResult, FlociTargetEnvResult } from './floci-resources-contract'
import { z } from 'zod'

function printable(value: string): boolean {
  return [...value].every((character) => {
    const code = character.charCodeAt(0)
    return code >= 32 && code !== 127
  })
}
const label = z.string().trim().min(1).max(80).refine(printable)
const profile = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .refine((value) => printable(value) && !value.startsWith('-'))
export const cloudConfigurationSchema = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('real'),
      provider: z.literal('aws'),
      profileName: profile,
      region: z
        .string()
        .min(1)
        .max(64)
        .regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)+-\d+$/),
      expectedAccountId: z
        .string()
        .regex(/^\d{12}$/)
        .optional(),
      expectedRoleArn: z
        .string()
        .max(512)
        .regex(/^arn:[a-z0-9-]+:iam::\d{12}:role\/[A-Za-z0-9+=,.@_/-]+$/)
        .optional()
    })
    .strict(),
  z
    .object({
      kind: z.literal('emulated'),
      provider: z.enum(['aws', 'azure', 'gcp', 'oci']),
      emulator: z.literal('floci'),
      cliVersion: z
        .string()
        .max(32)
        .regex(/^\d+\.\d+\.\d+$/)
        .optional(),
      runtimeId: z.literal('local'),
      engine: z.enum(['docker', 'podman']).optional(),
      requestedPort: z.number().int().min(1024).max(65535).optional()
    })
    .strict()
])
export const cloudMutationSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('add'), label, configuration: cloudConfigurationSchema }).strict(),
  z
    .object({
      kind: z.literal('update-real'),
      id: z.string().uuid(),
      configuration: cloudConfigurationSchema.refine((value) => value.kind === 'real')
    })
    .strict(),
  z.object({ kind: z.literal('rename'), id: z.string().uuid(), label }).strict(),
  z.object({ kind: z.literal('remove'), id: z.string().uuid() }).strict()
])
export const cloudTargetSchema = z
  .object({
    id: z.string().uuid(),
    label,
    configuration: cloudConfigurationSchema,
    displayRevision: z.number().int().nonnegative(),
    configRevision: z.number().int().nonnegative(),
    createdAt: z.number(),
    updatedAt: z.number(),
    deletedAt: z.number().nullable()
  })
  .strict()
export const cloudOwnerSchema = z
  .object({ hostId: z.literal('local'), root: z.string().min(1).max(4096) })
  .strict()
export const cloudSelectionSchema = z
  .object({
    projectId: z.string().min(1).max(4096),
    targetId: z.string().uuid().nullable(),
    generation: z.number().int().nonnegative(),
    owner: cloudOwnerSchema
  })
  .strict()
export type CloudTarget = z.infer<typeof cloudTargetSchema>
export type CloudMutation = z.infer<typeof cloudMutationSchema>
export type CloudSelection = z.infer<typeof cloudSelectionSchema>
export type CloudOwner = z.infer<typeof cloudOwnerSchema>
export type CloudCatalogSnapshot = {
  revision: number
  targets: CloudTarget[]
  selection: CloudSelection | null
}
export type CloudConnectionsSnapshot = CloudCatalogSnapshot & {
  namespaceId: string
  projectId: string
  owner: 'local' | 'unavailable'
}
export type CloudTargetCode =
  | 'invalid'
  | 'unavailable'
  | 'conflict'
  | 'workspace'
  | 'owner'
  | 'limit'
  | 'storage'
export const cloudTargetMessages: Record<CloudTargetCode, string> = {
  invalid: 'Invalid cloud target metadata.',
  unavailable: 'Target is unavailable.',
  conflict: 'Cloud targets changed. Refresh and try again.',
  workspace: 'Cloud targets require a project workspace.',
  owner: 'Cloud targets are not available on this runtime.',
  limit: 'This workspace already has 200 cloud targets. Remove one before adding another.',
  storage: 'Cloud target storage is unavailable.'
}
export class CloudTargetRefusal extends Error {
  constructor(public readonly code: CloudTargetCode) {
    super(cloudTargetMessages[code])
  }
}
export type CloudTargetResult =
  | { ok: true; snapshot: CloudConnectionsSnapshot }
  | { ok: false; code: CloudTargetCode; message: string }
export const cloudRequestSchema = z
  .object({
    projectId: z.string().min(1).max(4096),
    revision: z.number().int().nonnegative().optional(),
    mutation: cloudMutationSchema.optional(),
    selection: z.string().uuid().nullable().optional()
  })
  .strict()
export type CloudRequest = z.infer<typeof cloudRequestSchema>
export type CloudTargetsApi = {
  verifyRealTarget?: (args: {
    projectId: string
    targetId: string
  }) => Promise<RealAwsResult<RealAwsIdentity>>
  acceptRealIdentity?: (args: {
    projectId: string
    targetId: string
    observationId: string
    revision: number
  }) => Promise<RealAwsResult<RealAwsIdentity>>
  readRealTarget?: (args: {
    projectId: string
    targetId: string
    requestId: string
    operation: 'resources' | 'budgets' | 'cost-and-usage'
  }) => Promise<
    RealAwsResult<{
      identity: RealAwsIdentity
      data: RealAwsResources | RealAwsBudgets
      operations: string[]
    }>
  >
  /** Cost Explorer: prepare a challenge, confirm it into a one-use grant, then read once. */
  prepareRealCost?: (args: {
    projectId: string
    targetId: string
    requestId: string
  }) => Promise<RealAwsResult<RealAwsCostChallenge>>
  confirmRealCost?: (args: {
    projectId: string
    targetId: string
    challengeId: string
  }) => Promise<RealAwsResult<RealAwsCostGrant>>
  readRealCost?: (args: {
    projectId: string
    targetId: string
    requestId: string
    grantId?: string
  }) => Promise<RealAwsResult<RealAwsCostView>>
  cachedRealCost?: (args: {
    projectId: string
    targetId: string
  }) => Promise<RealAwsResult<RealAwsCostView | null>>
  read: (projectId: string) => Promise<CloudTargetResult>
  update: (request: CloudRequest) => Promise<CloudTargetResult>
  readRuntime?: (args: {
    projectId: string
    targetId: string
    refresh?: boolean
  }) => Promise<FlociResult>
  runLifecycle?: (args: FlociAction) => Promise<FlociResult>
  captureBinding?: (projectId: string) => Promise<CloudBinding>
  targetEnv?: (args: { projectId: string; targetId: string }) => Promise<FlociTargetEnvResult>
  listResources?: (args: { projectId: string; targetId: string }) => Promise<FlociResourcesResult>
  onChanged: (callback: () => void) => () => void
}
