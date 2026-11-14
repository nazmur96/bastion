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
  'consent-required': 'Cost Explorer is disabled in this version. No billing request was made.',
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
