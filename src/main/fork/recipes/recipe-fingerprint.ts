import { createHash } from 'node:crypto'
import type { RecipeFile } from '../../../shared/fork-recipes/object-storage-recipe'

/** sha256 over sorted paths and contents: what a review binds and an apply re-checks. */
export function recipeFingerprint(files: RecipeFile[]): string {
  const hash = createHash('sha256')
  for (const file of [...files].sort((a, b) => a.path.localeCompare(b.path))) {
    hash.update(`${file.path}\0${file.content}\0`)
  }
  return `sha256:${hash.digest('hex')}`
}
