import { renderObjectStorageBinding } from './object-storage-binding'
import { renderObjectStorageRecipe, type RecipeFile } from './object-storage-recipe'
import type { RecipeCreateRequest } from './recipe-contract'
import { renderSecretReference } from './secret-reference'
import { renderPostgresDatabase } from './postgres-database'
import { renderContainerRegistry, renderWorkloadRole } from './registry-and-role'

/** Fork: every recipe Bastion offers. Each renders new files under its own infra directory. */
export function renderRecipe(request: RecipeCreateRequest): {
  directory: string
  files: RecipeFile[]
} {
  switch (request.recipe) {
    case 'object-storage':
      return { directory: request.input.directory, files: renderObjectStorageRecipe(request.input) }
    case 'object-storage-binding':
      return {
        directory: request.input.directory,
        files: renderObjectStorageBinding(request.input)
      }
    case 'secret-reference':
      return { directory: request.input.directory, files: renderSecretReference(request.input) }
    case 'postgres-database':
      return { directory: request.input.directory, files: renderPostgresDatabase(request.input) }
    case 'container-registry':
      return { directory: request.input.directory, files: renderContainerRegistry(request.input) }
    case 'workload-role':
      return { directory: request.input.directory, files: renderWorkloadRole(request.input) }
  }
}
