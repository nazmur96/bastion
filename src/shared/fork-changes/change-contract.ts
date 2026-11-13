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
export const changeEntranceSchema = z.enum(['discovery', 'source'])
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
    adapter: z.literal('source-check/v1'),
    files: z.array(sourceSchema).min(1).max(20)
  })
  .strict()
  .refine(({ files }) =>
    files.every((file, index) => index === 0 || files[index - 1].path < file.path)
  )
export type ChangeSnapshot = z.infer<typeof changeSnapshotSchema>
export const sourceCheckCodeSchema = z.enum([
  'json-valid',
  'json-invalid',
  'readable',
  'changed',
  'unavailable'
])
export type SourceCheckCode = z.infer<typeof sourceCheckCodeSchema>
export type ChangeValidation = { id: string; at: number; snapshot: ChangeSnapshot }
export type ChangeReview = {
  id: string
  at: number
  validationId: string
  snapshot: ChangeSnapshot
}
export type ChangeRun = {
  id: string
  at: number
  reviewId: string
  snapshot: ChangeSnapshot
  steps: { path: string; code: SourceCheckCode; at: number }[]
  status: 'running' | 'passed' | 'failed' | 'interrupted'
  finishedAt: number | null
  verification: { at: number; code: 'unchanged' | 'changed' | 'unavailable' } | null
}
export type ChangeRecord = {
  id: string
  revision: number
  scope: ChangeScope
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
    entrances: z.array(changeEntranceSchema).max(2),
    validations: z
      .array(z.object({ id: text, at: timestamp, snapshot: changeSnapshotSchema }).strict())
      .max(1000),
    reviews: z
      .array(
        z
          .object({ id: text, at: timestamp, validationId: text, snapshot: changeSnapshotSchema })
          .strict()
      )
      .max(1000),
    runs: z
      .array(
        z
          .object({
            id: text,
            at: timestamp,
            reviewId: text,
            snapshot: changeSnapshotSchema,
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
      .max(1000)
  })
  .strict()

export const changeCommandSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('validate'), snapshot: changeSnapshotSchema }).strict(),
  z
    .object({ kind: z.literal('review'), validationId: text, snapshot: changeSnapshotSchema })
    .strict(),
  z.object({ kind: z.literal('start'), reviewId: text, snapshot: changeSnapshotSchema }).strict(),
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
  ensure: (args: { scope: ChangeScope; entrance: ChangeEntrance }) => Promise<ChangeRecord>
  command: (args: { id: string; revision: number; command: ChangeCommand }) => Promise<ChangeRecord>
}

export function sameChangeSnapshot(a: ChangeSnapshot, b: ChangeSnapshot): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

export function currentChangeReview(record: ChangeRecord): ChangeReview | undefined {
  const latest = record.validations.at(-1)
  const review = record.reviews.at(-1)
  return latest && review && sameChangeSnapshot(latest.snapshot, review.snapshot)
    ? review
    : undefined
}
