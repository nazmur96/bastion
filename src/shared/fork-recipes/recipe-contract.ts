import { z } from 'zod'
import { objectStorageInputSchema, recipeDirectorySchema } from './object-storage-recipe'
import { objectStorageBindingSchema } from './object-storage-binding'
import { secretReferenceSchema } from './secret-reference'
import { postgresDatabaseSchema } from './postgres-database'
import { containerRegistrySchema, workloadRoleSchema } from './registry-and-role'
import { messageQueueSchema, notificationTopicSchema } from './messaging-recipes'
import { keyValueTableSchema } from './key-value-table'
import { domainHttpsSchema } from './domain-and-https'

/** Fork: Recipes page ↔ main contract (Step 10.1). */
export type RecipeStep = {
  step: 'fmt' | 'init' | 'validate' | 'plan' | 'apply' | 'destroy' | 'output'
  ok: boolean
  message: string | null
}
const projectId = z.string().min(1).max(4096)
export const recipeCreateSchema = z.discriminatedUnion('recipe', [
  z
    .object({ projectId, recipe: z.literal('object-storage'), input: objectStorageInputSchema })
    .strict(),
  z
    .object({
      projectId,
      recipe: z.literal('object-storage-binding'),
      input: objectStorageBindingSchema
    })
    .strict(),
  z
    .object({ projectId, recipe: z.literal('secret-reference'), input: secretReferenceSchema })
    .strict(),
  z
    .object({ projectId, recipe: z.literal('postgres-database'), input: postgresDatabaseSchema })
    .strict(),
  z
    .object({ projectId, recipe: z.literal('container-registry'), input: containerRegistrySchema })
    .strict(),
  z.object({ projectId, recipe: z.literal('workload-role'), input: workloadRoleSchema }).strict(),
  z.object({ projectId, recipe: z.literal('message-queue'), input: messageQueueSchema }).strict(),
  z
    .object({
      projectId,
      recipe: z.literal('notification-topic'),
      input: notificationTopicSchema
    })
    .strict(),
  z
    .object({ projectId, recipe: z.literal('key-value-table'), input: keyValueTableSchema })
    .strict(),
  z.object({ projectId, recipe: z.literal('domain-https'), input: domainHttpsSchema }).strict()
])
export type RecipeCreateRequest = z.infer<typeof recipeCreateSchema>
export const recipeReadSchema = z.object({ projectId, directory: recipeDirectorySchema }).strict()
export const recipeDeliverSchema = recipeReadSchema
  .extend({
    targetId: z.string().uuid(),
    operation: z.enum(['apply', 'destroy']),
    fingerprint: z.string().regex(/^sha256:[0-9a-f]{64}$/)
  })
  .strict()
/** Real AWS: preparation mints a one-use grant; only the grant can start the change. */
export const recipeRealPrepareSchema = recipeDeliverSchema
export const recipeRealDeliverSchema = z
  .object({ grantId: z.string().uuid(), cancel: z.boolean().optional() })
  .strict()
export type RecipeRealChallenge = {
  grantId: string
  operation: 'apply' | 'destroy'
  directory: string
  files: string[]
  fingerprint: string
  accountId: string
  principalArn: string
  profileName: string
  region: string
  terraform: string
  /** What the saved plan will do; the confirmation applies exactly this plan. */
  plan: RecipePlanSummary
}
export type RecipePlanSummary = {
  add: number
  change: number
  replace: number
  destroy: number
  /** At most 50 resources, in plan order. */
  resources: { address: string; action: 'create' | 'update' | 'replace' | 'delete' }[]
  truncated: boolean
}
export type RecipeSnapshot = {
  directory: string
  files: { path: string; bytes: number }[]
  fingerprint: string
  /** New files created outside the infra directory, such as an application config example. */
  companions?: string[]
  /** A resource type the restricted local emulator cannot serve; null when Floci can. */
  flociUnsupported?: string | null
}
export type RecipeResult<T> = ({ ok: true } & T) | { ok: false; code: string; message: string }
export type RecipesApi = {
  create: (args: z.infer<typeof recipeCreateSchema>) => Promise<RecipeResult<RecipeSnapshot>>
  read: (args: z.infer<typeof recipeReadSchema>) => Promise<RecipeResult<RecipeSnapshot>>
  validate: (
    args: z.infer<typeof recipeReadSchema>
  ) => Promise<RecipeResult<{ steps: RecipeStep[]; tool: string }>>
  deliver: (
    args: z.infer<typeof recipeDeliverSchema>
  ) => Promise<RecipeResult<{ steps: RecipeStep[]; outputs: Record<string, string> }>>
  realPrepare: (
    args: z.infer<typeof recipeRealPrepareSchema>
  ) => Promise<RecipeResult<{ challenge: RecipeRealChallenge }>>
  realDeliver: (
    args: z.infer<typeof recipeRealDeliverSchema>
  ) => Promise<
    RecipeResult<{ steps: RecipeStep[]; outputs: Record<string, string>; receiptId: string }>
  >
}
