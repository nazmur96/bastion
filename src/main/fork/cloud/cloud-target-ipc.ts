import { app, ipcMain, type WebContents } from 'electron'
import type { Store } from '../../persistence'
import { isTrustedUIRenderer } from '../../ipc/ui'
import { readProjectWorkspaceContext } from '../project-workspaces/workspace-context'
import { CloudTargetCatalog } from './cloud-target-catalog'
import {
  cloudProjectRegistration,
  resolveCloudProjectOwner,
  type CloudProjectRuntime
} from './cloud-target-owner'
import {
  cloudRequestSchema,
  CloudTargetRefusal,
  cloudTargetMessages,
  type CloudTargetResult,
  type CloudOwner
} from '../../../shared/fork-cloud/cloud-target-contract'

export function registerCloudTargetHandlers(
  store: Pick<Store, 'getRepos' | 'getFolderWorkspaces' | 'getProjectGroups'>,
  runtime: CloudProjectRuntime
): void {
  let catalog: CloudTargetCatalog | undefined
  const subscribers = new Set<WebContents>()
  async function request(
    sender: WebContents,
    raw: unknown,
    update: boolean
  ): Promise<CloudTargetResult> {
    try {
      const context = readProjectWorkspaceContext()
      if (!isTrustedUIRenderer(sender) || !context?.workspace || context.incognito) {
        throw new CloudTargetRefusal('workspace')
      }
      const parsed = cloudRequestSchema.safeParse(raw)
      if (!parsed.success) {
        throw new CloudTargetRefusal('invalid')
      }
      const args = parsed.data
      if (
        (!update &&
          (args.revision !== undefined || args.mutation || args.selection !== undefined)) ||
        (update &&
          (args.revision === undefined ||
            Number(Boolean(args.mutation)) + Number(args.selection !== undefined) !== 1))
      ) {
        throw new CloudTargetRefusal('invalid')
      }
      let owner: CloudOwner | null = null
      try {
        const registration = cloudProjectRegistration(store, args.projectId)
        owner = await resolveCloudProjectOwner(store, runtime, args.projectId)
        if (cloudProjectRegistration(store, args.projectId).stamp !== registration.stamp) {
          owner = null
        }
      } catch (error) {
        if (!(error instanceof CloudTargetRefusal && error.code === 'owner')) {
          throw error
        }
      }
      if (sender.isDestroyed() || readProjectWorkspaceContext() !== context) {
        throw new CloudTargetRefusal('workspace')
      }
      catalog ??= new CloudTargetCatalog(context.dataRoot)
      if (!subscribers.has(sender)) {
        subscribers.add(sender)
        sender.once('destroyed', () => subscribers.delete(sender))
      }
      if (update && args.revision !== undefined) {
        if (args.mutation) {
          catalog.mutate(args.revision, args.mutation)
        } else {
          if (!owner) {
            throw new CloudTargetRefusal('owner')
          }
          catalog.select(args.revision, args.projectId, args.selection ?? null, owner)
        }
        for (const subscriber of subscribers) {
          if (!subscriber.isDestroyed()) {
            subscriber.send('bastionCloud:changed')
          }
        }
      }
      const snapshot = catalog.snapshot(args.projectId)
      const selection =
        owner && snapshot.selection?.owner.root === owner.root ? snapshot.selection : null
      return {
        ok: true,
        snapshot: {
          ...snapshot,
          selection,
          namespaceId: context.activeId,
          projectId: args.projectId,
          owner: owner ? 'local' : 'unavailable'
        }
      }
    } catch (error) {
      const code = error instanceof CloudTargetRefusal ? error.code : 'storage'
      return { ok: false, code, message: cloudTargetMessages[code] }
    }
  }
  ipcMain.handle('bastionCloud:read', (event, raw: unknown) =>
    event.senderFrame === event.sender.mainFrame
      ? request(event.sender, raw, false)
      : { ok: false, code: 'workspace', message: cloudTargetMessages.workspace }
  )
  ipcMain.handle('bastionCloud:update', (event, raw: unknown) =>
    event.senderFrame === event.sender.mainFrame
      ? request(event.sender, raw, true)
      : { ok: false, code: 'workspace', message: cloudTargetMessages.workspace }
  )
  app.once('will-quit', () => {
    subscribers.clear()
    catalog?.close()
    catalog = undefined
  })
}
