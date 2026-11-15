import { z } from 'zod'
import { objectStorageInputSchema, recipeDirectorySchema } from './object-storage-recipe'

/** Fork: Recipes page ↔ main contract (Step 10.1). */
export type RecipeStep = {
  step: 'fmt' | 'init' | 'validate' | 'apply' | 'destroy' | 'output'
  ok: boolean
  message: string | null
}
const projectId = z.string().min(1).max(4096)
export const recipeCreateSchema = z
  .object({ projectId, recipe: z.literal('object-storage'), input: objectStorageInputSchema })
  .strict()
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
