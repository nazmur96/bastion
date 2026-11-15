import { z } from 'zod'
import { objectStorageInputSchema, recipeDirectorySchema } from './object-storage-recipe'
import { objectStorageBindingSchema } from './object-storage-binding'
import { secretReferenceSchema } from './secret-reference'

/** Fork: Recipes page ↔ main contract (Step 10.1). */
export type RecipeStep = {
  step: 'fmt' | 'init' | 'validate' | 'apply' | 'destroy' | 'output'
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
    .strict()
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
export type RecipeSnapshot = {
  directory: string
  files: { path: string; bytes: number }[]
  fingerprint: string
  /** New files created outside the infra directory, such as an application config example. */
  companions?: string[]
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
}
