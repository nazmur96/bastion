import { z } from 'zod'

const text = z
  .string()
  .min(1)
  .max(4096)
  .refine((value) => !value.includes('\0'))
export const changeScopeSchema = z
  .object({
    projectId: text,
    root: text,
    hostId: text,
    routeKey: text
  })
  .strict()
export type ChangeScope = z.infer<typeof changeScopeSchema>
export const changeIntentSchema = z
  .object({
    id: z.string().min(1).max(160),
    kind: z.enum(['source-check', 'create-file']),
    label: z.string().min(1).max(120).optional()
  })
  .strict()
export type ChangeIntent = z.infer<typeof changeIntentSchema>
export const SOURCE_CHECK_INTENT: ChangeIntent = { id: 'source-check', kind: 'source-check' }
export const changeEntranceSchema = z.enum(['discovery', 'source', 'cloud', 'recipes', 'agent'])
export type ChangeEntrance = z.infer<typeof changeEntranceSchema>

export function isChangeSourcePath(path: string): boolean {
  return (
    !path.split('/').some((part) => !part || part === '.' || part === '..') &&
    !/[\\:\0]/.test(path) &&
    !/(^|\/)(\.env[^/]*|\.git|\.terraform|node_modules|vendor|dist|build|\.venv)(\/|$)|\.tfvars(?:\.json)?$|\.enc\.[^/]+$|secret|credential|kubeconfig|htpasswd|\.tfstate(?:\.|$)|\.pem$|\.key$/i.test(
      path
    ) &&
    /(?:\.(?:json|tf|ya?ml|toml|nix)|(?:^|\/)(?:Dockerfile|Containerfile|go\.mod))$/.test(path)
  )
}

export const changePathSchema = z.string().min(1).max(512).refine(isChangeSourcePath)
const sourceSchema = z
  .object({
    path: changePathSchema,
    fingerprint: z.string().regex(/^[0-9a-f]{1,8}-[0-9a-f]{1,8}-[0-9a-f]{1,13}$/)
  })
  .strict()
export const changeSnapshotSchema = z
  .object({
    adapter: z.enum(['source-check/v1', 'create-file/v1']),
    ownerRuntimeId: text.optional(),
    files: z.array(sourceSchema).min(1).max(20)
  })
  .strict()
  .refine(({ files }) =>
    files.every((file, index) => index === 0 || files[index - 1].path < file.path)
  )
  .refine(
    ({ adapter, files }) =>
      adapter !== 'create-file/v1' || (files.length === 1 && !files[0].path.includes('/'))
  )
export type ChangeSnapshot = z.infer<typeof changeSnapshotSchema>
export const sourceCheckCodeSchema = z.enum([
  'json-valid',
  'json-invalid',
  'readable',
  'changed',
  'unavailable',
  'created',
  'conflict'
])
export type SourceCheckCode = z.infer<typeof sourceCheckCodeSchema>
export type ChangeValidation = {
  id: string
  at: number
  snapshot: ChangeSnapshot
  scope?: ChangeScope
}
export type ChangeReview = {
  id: string
  at: number
  validationId: string
  snapshot: ChangeSnapshot
  scope?: ChangeScope
}
export type ChangeRun = {
  id: string
  at: number
  reviewId: string
  snapshot: ChangeSnapshot
  scope?: ChangeScope
  execution?: { runtimeId: string }
  steps: { path: string; code: SourceCheckCode; at: number }[]
  status: 'running' | 'passed' | 'failed' | 'interrupted'
  finishedAt: number | null
  verification: { at: number; code: 'unchanged' | 'changed' | 'unavailable' } | null
}
export type ChangeRecord = {
  id: string
  revision: number
  scope: ChangeScope
  intent?: ChangeIntent
  invalidated?: boolean
  entrances: ChangeEntrance[]
  validations: ChangeValidation[]
  reviews: ChangeReview[]
  runs: ChangeRun[]
}

const timestamp = z.number().int().nonnegative()
export const changeRecordSchema: z.ZodType<ChangeRecord> = z
  .object({
    id: text,
    revision: timestamp,
    scope: changeScopeSchema,
    intent: changeIntentSchema.optional(),
    invalidated: z.boolean().optional(),
    entrances: z.array(changeEntranceSchema).max(5),
    validations: z
      .array(
        z
          .object({
            id: text,
            at: timestamp,
            snapshot: changeSnapshotSchema,
            scope: changeScopeSchema.optional()
          })
          .strict()
      )
      .max(10000),
    reviews: z
      .array(
        z
          .object({
            id: text,
            at: timestamp,
            validationId: text,
            snapshot: changeSnapshotSchema,
            scope: changeScopeSchema.optional()
          })
          .strict()
      )
      .max(10000),
    runs: z
      .array(
        z
          .object({
            id: text,
            at: timestamp,
            reviewId: text,
            snapshot: changeSnapshotSchema,
            scope: changeScopeSchema.optional(),
            execution: z.object({ runtimeId: text }).strict().optional(),
            steps: z
              .array(
                z
                  .object({ path: changePathSchema, code: sourceCheckCodeSchema, at: timestamp })
                  .strict()
              )
              .max(20),
            status: z.enum(['running', 'passed', 'failed', 'interrupted']),
            finishedAt: timestamp.nullable(),
            verification: z
              .object({ at: timestamp, code: z.enum(['unchanged', 'changed', 'unavailable']) })
              .strict()
              .nullable()
          })
          .strict()
      )
      .max(10000)
  })
  .strict()

export const ownerRunReceiptSchema = z
  .object({
    id: z.string().uuid(),
    runtimeId: z.string().min(1).max(4096),
    ownerPid: z.number().int().positive(),
    worktreeId: z.string().min(1).max(4096),
    root: z.string().min(1).max(4096),
    snapshot: changeSnapshotSchema,
    at: z.number().int().nonnegative(),
    steps: z
      .array(
        z
          .object({
            path: changePathSchema,
            code: sourceCheckCodeSchema,
            at: z.number().int().nonnegative()
          })
          .strict()
      )
      .max(20),
    status: z.enum(['running', 'passed', 'failed', 'interrupted']),
    finishedAt: z.number().int().nonnegative().nullable(),
    verification: z
      .object({
        at: z.number().int().nonnegative(),
        code: z.enum(['unchanged', 'changed', 'unavailable'])
      })
      .strict()
      .nullable()
  })
  .strict()
  .refine((receipt) => (receipt.status === 'running') === (receipt.finishedAt === null))
  .refine((receipt) =>
    receipt.steps.every((step, index) => step.path === receipt.snapshot.files[index]?.path)
  )
  .refine(
    (receipt) =>
      receipt.status !== 'passed' ||
      (receipt.steps.length === receipt.snapshot.files.length &&
        receipt.steps.every((step) =>
          receipt.snapshot.adapter === 'create-file/v1'
            ? step.code === 'created'
            : step.code === 'readable' || step.code === 'json-valid'
        ))
  )
export type OwnerRunReceipt = z.infer<typeof ownerRunReceiptSchema>

export const changeCommandSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('invalidate') }).strict(),
  z.object({ kind: z.literal('reconcile'), receipt: ownerRunReceiptSchema }).strict(),
  z.object({ kind: z.literal('interrupt'), runId: text }).strict(),
  z.object({ kind: z.literal('validate'), snapshot: changeSnapshotSchema }).strict(),
  z
    .object({ kind: z.literal('review'), validationId: text, snapshot: changeSnapshotSchema })
    .strict(),
  z
    .object({
      kind: z.literal('start'),
      reviewId: text,
      snapshot: changeSnapshotSchema,
      execution: z.object({ runtimeId: text }).strict().optional()
    })
    .strict(),
  z
    .object({
      kind: z.literal('step'),
      runId: text,
      path: changePathSchema,
      code: sourceCheckCodeSchema
    })
    .strict(),
  z.object({ kind: z.literal('finish'), runId: text }).strict(),
  z
    .object({
      kind: z.literal('verify'),
      runId: text,
      code: z.enum(['unchanged', 'changed', 'unavailable'])
    })
    .strict()
])
export type ChangeCommand = z.infer<typeof changeCommandSchema>
export type ChangesApi = {
  ensure: (args: {
    scope: ChangeScope
    entrance: ChangeEntrance
    intent?: ChangeIntent
  }) => Promise<ChangeRecord>
  list: (args: { projectId: string }) => Promise<ChangeRecord[]>
  command: (args: { id: string; revision: number; command: ChangeCommand }) => Promise<ChangeRecord>
}

export function sameChangeSnapshot(a: ChangeSnapshot, b: ChangeSnapshot): boolean {
  return (
    JSON.stringify(changeSnapshotSchema.parse(a)) === JSON.stringify(changeSnapshotSchema.parse(b))
  )
}

export function currentChangeReview(record: ChangeRecord): ChangeReview | undefined {
  if (record.invalidated) {
    return undefined
  }
  const latest = record.validations.at(-1)
  const review = record.reviews.at(-1)
  return latest &&
    review &&
    review.validationId === latest.id &&
    sameChangeSnapshot(latest.snapshot, review.snapshot) &&
    sameChangeScope(latest.scope ?? record.scope, record.scope) &&
    sameChangeScope(review.scope ?? record.scope, record.scope)
    ? review
    : undefined
}

export function sameChangeScope(a: ChangeScope, b: ChangeScope): boolean {
  return JSON.stringify(changeScopeSchema.parse(a)) === JSON.stringify(changeScopeSchema.parse(b))
}

export { sameChangeTarget } from './change-target'
