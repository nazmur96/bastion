import { z } from 'zod'
export const realAwsMessages = {
  invalid: 'Invalid real AWS request.',
  workspace: 'Real AWS requires a project workspace.',
  'owner-changed': 'The project owner or selected target changed. Verify again.',
  'tool-unavailable':
    'This project needs an exact installed AWS CLI v2 pin in its own mise.toml. No host fallback or installation was attempted.',
  'cli-session-expired':
    'Your CLI session has expired. Sign in again using your profile’s normal method, then verify again.',
  'service-token-expired': 'AWS reported an expired token. Sign in again, then verify again.',
  'cli-failed': 'The AWS CLI request failed. No automatic sign-in or fallback was attempted.',
  'auth-unavailable':
    'The selected profile could not supply authentication. Use its normal sign-in method, then verify again.',
  denied: 'AWS denied this read. Its result is unknown.',
  timeout: 'The AWS read timed out.',
  'too-large': 'The response exceeded the read size limit.',
  unreadable: 'The AWS response could not be read.',
  'identity-mismatch': 'The observed AWS identity does not match this target’s expectation.',
  'identity-required': 'Verify and accept the real AWS identity before reading resources.',
  'consent-required':
    'This Cost Explorer read needs a fresh confirmation for this target. No billing request was made.',
  'no-cost-period': 'The current UTC month has no complete day yet. No billing request was made.',
  duplicate: 'This request was already made. Start a new read.',
  busy: 'A real AWS request for this target is already active.',
  storage: 'Real AWS metadata is unavailable.'
} as const
export type RealAwsCode = keyof typeof realAwsMessages
export class RealAwsFailure extends Error {
  constructor(readonly code: RealAwsCode) {
    super(realAwsMessages[code])
  }
}
export const realAwsRefSchema = z
  .object({ projectId: z.string().min(1).max(4096), targetId: z.string().uuid() })
  .strict()
export const realAwsReadSchema = realAwsRefSchema
  .extend({
    requestId: z.string().uuid(),
    operation: z.enum(['resources', 'budgets', 'cost-and-usage'])
  })
  .strict()
export const realAwsAcceptSchema = realAwsRefSchema
  .extend({ observationId: z.string().uuid(), revision: z.number().int().nonnegative() })
  .strict()
export type RealAwsIdentity = {
  observationId: string
  accountId: string
  arn: string
  userId: string
  roleArn: string | null
  profileName: string
  region: string
  checkedAt: number
  expiresAt: null
  anchored: boolean
  toolVersion: string
}
export type RealAwsService = 'tagging' | 's3' | 'dynamodb' | 'sqs' | 'lambda'
export type RealAwsResources = {
  at: number
  results: {
    service: RealAwsService
    status: 'ok' | RealAwsCode
    items: { name: string; arn: string | null }[]
    truncated: boolean
  }[]
}
export type RealAwsBudgets = {
  at: number
  status: 'present' | 'absent' | 'unknown'
  accountWide: boolean
  alerts: number
  subscriberTypes: string[]
  truncated: boolean
}
export type RealAwsResult<T> =
  | { ok: true; kind: 'real-aws'; value: T }
  | { ok: false; code: RealAwsCode; message: string }
export const realAwsCostPrepareSchema = realAwsRefSchema
  .extend({ requestId: z.string().uuid() })
  .strict()
export const realAwsCostConfirmSchema = realAwsRefSchema
  .extend({ challengeId: z.string().uuid() })
  .strict()
export const realAwsCostReadSchema = realAwsRefSchema
  .extend({ requestId: z.string().uuid(), grantId: z.string().uuid().optional() })
  .strict()
/** The only Cost Explorer query: built in main, never by the renderer. */
export type RealAwsCostQuery = {
  TimePeriod: { Start: string; End: string }
  Granularity: 'DAILY'
  Metrics: ['UnblendedCost']
  Filter: { Dimensions: { Key: 'LINKED_ACCOUNT'; Values: [string] } }
}
export type RealAwsCostChallenge = {
  challengeId: string
  requestId: string
  accountId: string
  principalArn: string
  profileName: string
  endpointRegion: 'us-east-1'
  query: RealAwsCostQuery
  expiresAt: number
}
export type RealAwsCostGrant = { grantId: string; expiresAt: number }
export type RealAwsCostData = {
  results: { start: string; end: string; amount: string; unit: string; estimated: boolean }[]
  moreAvailable: boolean
}
export type RealAwsCostView = {
  requestId: string
  status: 'running' | 'completed' | 'failed' | 'unknown'
  code?: string
  observedAt?: number
  accountId?: string
  query?: RealAwsCostQuery
  data?: RealAwsCostData
}
const fingerprint = z.string().regex(/^sha256:[0-9a-f]{64}$/)
/** Durable read evidence: fixed codes and counts only, never payloads, tokens or grants. */
export const realAwsReadReceiptSchema = z
  .object({
    requestId: z.string().uuid(),
    namespaceId: z.string().min(1).max(256),
    projectId: z.string().min(1).max(4096),
    targetId: z.string().uuid(),
    operation: z.enum(['verify', 'resources', 'budgets', 'cost-and-usage']),
    contextFingerprint: fingerprint,
    toolFingerprint: fingerprint,
    identityFingerprint: fingerprint,
    ownerRunId: z.string().min(1).max(128),
    at: z.number().int().nonnegative(),
    status: z.enum(['running', 'completed', 'failed', 'unknown']),
    finishedAt: z.number().int().nonnegative().optional(),
    code: z
      .string()
      .regex(/^[a-z-]{1,40}$/)
      .optional(),
    results: z
      .array(
        z
          .object({
            code: z.string().regex(/^[a-z-]{1,40}$/),
            count: z.number().int().nonnegative(),
            truncated: z.boolean()
          })
          .strict()
      )
      .max(10)
      .optional()
  })
  .strict()
export type RealAwsReadReceipt = z.infer<typeof realAwsReadReceiptSchema>
