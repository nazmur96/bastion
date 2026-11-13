import { z } from 'zod'
import { changePathSchema, changeSnapshotSchema } from './change-contract'
import { FileMutationOpen } from '../rpc-contract/files-mutation-params'

export const OwnerRunGet = FileMutationOpen.omit({ relativePath: true })
  .extend({
    runId: z.string().uuid(),
    expectedRoot: z.string().min(1).max(4096),
    expectedRuntimeId: z.string().min(1).max(4096)
  })
  .strict()
export const OwnerRunExecute = OwnerRunGet.extend({
  snapshot: changeSnapshotSchema,
  proposal: z.string().max(65536).optional()
}).strict()
export type OwnerRunRequest = z.infer<typeof OwnerRunExecute>
export type OwnerRunQuery = z.infer<typeof OwnerRunGet>

export function isRootSourceFilename(path: string): boolean {
  return (
    changePathSchema.safeParse(path).success &&
    !path.includes('/') &&
    !path.startsWith('.') &&
    !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(path) &&
    !/[<>"|?*]/.test(path) &&
    ![...path].some((character) => character.charCodeAt(0) < 32)
  )
}
