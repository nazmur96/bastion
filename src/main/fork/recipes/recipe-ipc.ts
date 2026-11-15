import { ipcMain, type WebContents } from 'electron'
import { readProjectWorkspaceContext } from '../project-workspaces/workspace-context'
import { isTrustedUIRenderer } from '../../ipc/ui'
import { admitChannelOperation } from '../../../shared/fork-cloud/operation-capabilities'
import { renderRecipe } from '../../../shared/fork-recipes/catalog'
import {
  recipeCreateSchema,
  recipeDeliverSchema,
  recipeReadSchema,
  type RecipeSnapshot
} from '../../../shared/fork-recipes/recipe-contract'
import type { CloudWorkspaceProvider } from '../cloud/cloud-workspace-provider'
import { recipeFingerprint } from './recipe-fingerprint'
import { RecipeFileError, readRecipeFiles, writeRecipeFiles } from './recipe-files'
import { RecipeRunError, deliverRecipeToFloci, validateRecipe } from './recipe-runner'
import { TerraformToolError, resolveTerraform } from './terraform-tool'

const MESSAGES: Record<string, string> = {
  invalid: 'Invalid recipe request.',
  workspace: 'Recipes require a project workspace.',
  owner: 'Recipes run on this computer only for now. Remote (SSH) projects are planned.',
  exists:
    'That directory already exists. Choose a new directory; existing files are never overwritten.',
  'unsafe-path': 'The recipe directory path contains a symlink or a file. Nothing was written.',
  layout: 'The recipe directory must hold only top-level files (no module subdirectories).',
  'too-large': 'A recipe file is larger than 64 KiB.',
  changed: 'The files changed since you reviewed them. Review the current files again.',
  target: 'Select and start a Floci AWS target before applying.',
  failed: 'The recipe operation failed.'
}
function failure(error: unknown): { ok: false; code: string; message: string } {
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
async function snapshot(root: string, directory: string): Promise<RecipeSnapshot> {
  const files = await readRecipeFiles(root, directory)
  return {
    directory,
    files: files.map((file) => ({ path: file.path, bytes: Buffer.byteLength(file.content) })),
    fingerprint: recipeFingerprint(files)
  }
}

/** Fork: Step 10.1 recipe handlers. Local owners only; every call is admitted by the registry. */
export function registerRecipeHandlers(
  requireProvider: (sender: WebContents) => CloudWorkspaceProvider
): void {
  for (const operation of [
    'recipeCreate',
    'recipeRead',
    'recipeValidate',
    'recipeDeliver'
  ] as const) {
    ipcMain.handle(`bastionCloud:${operation}`, async (event, raw: unknown) => {
      try {
        const context = readProjectWorkspaceContext()
        const assertCurrent = () => {
          if (
            !context?.workspace ||
            context.incognito ||
            readProjectWorkspaceContext() !== context ||
            event.sender.isDestroyed() ||
            !isTrustedUIRenderer(event.sender) ||
            event.senderFrame !== event.sender.mainFrame
          ) {
            throw new Error('workspace')
          }
        }
        assertCurrent()
        const provider = requireProvider(event.sender)
        if (operation === 'recipeCreate') {
          const parsed = recipeCreateSchema.safeParse(raw)
          if (!parsed.success) {
            throw new Error('invalid')
          }
          admitChannelOperation('bastionCloud:recipeCreate', 'recipes.create')
          const { owner, assertOwner } = await provider.owner(parsed.data.projectId)
          assertOwner()
          const { directory, files } = renderRecipe(parsed.data)
          await writeRecipeFiles(owner.root, files, directory)
          assertCurrent()
          const companions = files
            .map((file) => file.path)
            .filter((path) => !path.startsWith(`${directory}/`))
          return { ok: true, ...(await snapshot(owner.root, directory)), companions }
        }
        if (operation === 'recipeRead' || operation === 'recipeValidate') {
          const parsed = recipeReadSchema.safeParse(raw)
          if (!parsed.success) {
            throw new Error('invalid')
          }
          const { owner, assertOwner } = await provider.owner(parsed.data.projectId)
          if (operation === 'recipeRead') {
            admitChannelOperation('bastionCloud:recipeRead', 'recipes.read')
            return { ok: true, ...(await snapshot(owner.root, parsed.data.directory)) }
          }
          admitChannelOperation('bastionCloud:recipeValidate', 'recipes.validate')
          const tool = await resolveTerraform(owner.root)
          const files = await readRecipeFiles(owner.root, parsed.data.directory)
          const steps = await validateRecipe(
            { dataRoot: provider.root, owner: process.env, tool },
            parsed.data.directory,
            files
          )
          assertOwner()
          assertCurrent()
          return { ok: true, steps, tool: `Terraform ${tool.version}` }
        }
        const parsed = recipeDeliverSchema.safeParse(raw)
        if (!parsed.success) {
          throw new Error('invalid')
        }
        admitChannelOperation(
          'bastionCloud:recipeDeliver',
          parsed.data.operation === 'apply' ? 'recipes.apply-emulated' : 'recipes.destroy-emulated'
        )
        const { owner, assertOwner } = await provider.owner(parsed.data.projectId)
        const tool = await resolveTerraform(owner.root)
        const files = await readRecipeFiles(owner.root, parsed.data.directory)
        let target
        try {
          target = await provider.recipeTarget(parsed.data.projectId, parsed.data.targetId)
        } catch {
          throw new Error('target')
        }
        try {
          const result = await deliverRecipeToFloci(
            { dataRoot: provider.root, owner: process.env, tool },
            {
              operation: parsed.data.operation,
              directory: parsed.data.directory,
              files,
              reviewedFingerprint: parsed.data.fingerprint,
              instanceId: target.instanceId,
              flociEnv: target.env
            }
          )
          target.assertSameInstance()
          assertOwner()
          assertCurrent()
          return { ok: true, ...result }
        } finally {
          await target.finish()
        }
      } catch (error) {
        return failure(error)
      }
    })
  }
}
