import { ipcMain, type WebContents } from 'electron'
import { readProjectWorkspaceContext } from '../project-workspaces/workspace-context'
import { isTrustedUIRenderer } from '../../ipc/ui'
import { admitChannelOperation } from '../../../shared/fork-cloud/operation-capabilities'
import { RealAwsFailure, realAwsMessages } from '../../../shared/fork-cloud/real-aws-contract'
import {
  recipeRealDeliverSchema,
  recipeRealPrepareSchema
} from '../../../shared/fork-recipes/recipe-contract'
import type { CloudWorkspaceProvider } from '../cloud/cloud-workspace-provider'
import { RecipeFileError } from './recipe-files'
import { RealRecipeDesk } from './recipe-real'
import { RecipeRunError } from './recipe-runner'
import { TerraformToolError, resolveTerraform } from './terraform-tool'

const MESSAGES: Record<string, string> = {
  invalid: 'Invalid recipe request.',
  workspace: 'Recipes require a project workspace.',
  changed: 'The files changed since you reviewed them. Review the current files again.',
  grant:
    'This confirmation expired or no longer matches the verified account. Nothing was changed; prepare the change again.',
  failed: 'The recipe operation failed.'
}
const desks = new WeakMap<CloudWorkspaceProvider, RealRecipeDesk>()
function desk(provider: CloudWorkspaceProvider): RealRecipeDesk {
  let current = desks.get(provider)
  if (!current) {
    current = new RealRecipeDesk(
      provider.root,
      (projectId, targetId) => provider.real.anchored(projectId, targetId),
      resolveTerraform
    )
    desks.set(provider, current)
  }
  return current
}
function failure(error: unknown): { ok: false; code: string; message: string } {
  if (error instanceof RealAwsFailure) {
    return { ok: false, code: error.code, message: realAwsMessages[error.code] }
  }
  const code =
    error instanceof RecipeFileError || error instanceof RecipeRunError
      ? error.code
      : error instanceof TerraformToolError
        ? 'tool'
        : error instanceof Error && error.message in MESSAGES
          ? error.message
          : 'failed'
  return {
    ok: false,
    code,
    message:
      code === 'tool' && error instanceof Error
        ? error.message
        : (MESSAGES[code] ?? MESSAGES.failed)
  }
}

/** Fork: Step 13.3 real-AWS recipe changes. Local owners; anchored identity; one-use grant. */
export function registerRealRecipeHandlers(
  requireProvider: (sender: WebContents) => CloudWorkspaceProvider
): void {
  for (const operation of ['recipeRealPrepare', 'recipeRealDeliver'] as const) {
    ipcMain.handle(`bastionCloud:${operation}`, async (event, raw: unknown) => {
      try {
        const context = readProjectWorkspaceContext()
        if (
          !context?.workspace ||
          context.incognito ||
          event.sender.isDestroyed() ||
          !isTrustedUIRenderer(event.sender) ||
          event.senderFrame !== event.sender.mainFrame
        ) {
          throw new Error('workspace')
        }
        const provider = requireProvider(event.sender)
        if (operation === 'recipeRealPrepare') {
          const parsed = recipeRealPrepareSchema.safeParse(raw)
          if (!parsed.success) {
            throw new Error('invalid')
          }
          admitChannelOperation('bastionCloud:recipeRealPrepare', 'recipes.prepare-real')
          return { ok: true, challenge: await desk(provider).prepare(parsed.data) }
        }
        const parsed = recipeRealDeliverSchema.safeParse(raw)
        if (!parsed.success) {
          throw new Error('invalid')
        }
        if (parsed.data.cancel) {
          desk(provider).cancel(parsed.data.grantId)
          return { ok: true, steps: [], outputs: {}, receiptId: '' }
        }
        // The grant names the operation; admit the matching registry entry before running it.
        const pending = desk(provider).pendingOperation(parsed.data.grantId)
        admitChannelOperation(
          'bastionCloud:recipeRealDeliver',
          pending === 'destroy' ? 'recipes.destroy-real' : 'recipes.apply-real'
        )
        if (readProjectWorkspaceContext() !== context) {
          throw new Error('workspace')
        }
        return { ok: true, ...(await desk(provider).deliver(parsed.data.grantId)) }
      } catch (error) {
        return failure(error)
      }
    })
  }
}
