import { z } from 'zod'

export const FLOCI_RESOURCE_SERVICES = ['tagging', 's3', 'dynamodb', 'sqs', 'lambda'] as const
export type FlociResourceService = (typeof FLOCI_RESOURCE_SERVICES)[number]
export const FLOCI_RESOURCE_LABELS: Record<FlociResourceService, string> = {
  tagging: 'Tagged resources',
  s3: 'S3 buckets',
  dynamodb: 'DynamoDB tables',
  sqs: 'SQS queues',
  lambda: 'Lambda functions'
}
/** Bounded metadata only: no tag values, payloads, object contents or function configuration. */
export type FlociResourceItem = { name: string; arn: string | null }
export type FlociServiceStatus =
  | 'ok'
  | 'denied'
  | 'unimplemented'
  | 'invalid'
  | 'too-large'
  | 'timeout'
  | 'error'
export const FLOCI_SERVICE_STATUS_MESSAGES: Record<FlociServiceStatus, string> = {
  ok: 'Listed.',
  denied: 'The emulator refused this listing.',
  unimplemented: 'This emulator does not support this listing.',
  invalid: 'The emulator returned a response that could not be read.',
  'too-large': 'The response exceeded the listing size limit.',
  timeout: 'The listing timed out.',
  error: 'The listing failed.'
}
export type FlociServiceResult = {
  service: FlociResourceService
  status: FlociServiceStatus
  items: FlociResourceItem[]
  /** More items may exist beyond the page, item or time limits. */
  truncated: boolean
}
export type FlociResources = { at: number; results: FlociServiceResult[] }
export const flociResourcesRequestSchema = z
  .object({ projectId: z.string().min(1).max(4096), targetId: z.string().uuid() })
  .strict()
export type FlociResourcesResult =
  | { ok: true; resources: FlociResources }
  | { ok: false; code: string; message: string }
export type FlociTargetEnvResult =
  | { ok: true; env: Record<string, string> }
  | { ok: false; code: string; message: string }
