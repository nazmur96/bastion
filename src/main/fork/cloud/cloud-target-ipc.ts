import { z } from 'zod'
import { CloudWorkspaceProvider } from './cloud-workspace-provider'
import { setCloudBindingAuthority } from './cloud-binding-authority'
import { setFlociEnvResolver } from './floci-env-authority'
import { flociResourcesRequestSchema } from '../../../shared/fork-cloud/floci-resources-contract'
import {
  flociReadSchema,
  flociActionSchema,
  FlociFailure,
  flociMessages,
  type FlociResult
} from '../../../shared/fork-cloud/floci-contract'
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
  let provider: CloudWorkspaceProvider | undefined
  const notify = () => {
    for (const sender of subscribers) {
      if (!sender.isDestroyed()) {
        sender.send('bastionCloud:changed')
      }
    }
  }
  const requireProvider = (sender: WebContents) => {
    const context = readProjectWorkspaceContext()
    if (!isTrustedUIRenderer(sender) || !context?.workspace || context.incognito) {
      throw new FlociFailure('owner-changed')
    }
    catalog ??= new CloudTargetCatalog(context.dataRoot)
    provider ??= new CloudWorkspaceProvider(
      context.dataRoot,
      context.activeId,
      catalog,
      store,
      runtime,
      notify
    )
    return provider
  }
  setCloudBindingAuthority({
    capture: (scope) => {
      if (!provider) {
        throw new Error('Open Cloud before preparing a target-bound change.')
      }
      return provider.capture(scope)
    },
    claim: (id, snapshot, scope) => {
      if (!provider) {
        throw new Error('Cloud owner unavailable.')
      }
      return provider.claim(id, snapshot, scope)
    }
  })
  for (const operation of ['readRuntime', 'runLifecycle'] as const) {
    ipcMain.handle(
      `bastionCloud:${operation}`,
      async (event, raw: unknown): Promise<FlociResult> => {
        try {
          if (event.senderFrame !== event.sender.mainFrame) {
            throw new FlociFailure('owner-changed')
          }
          if (operation === 'runLifecycle') {
            const parsed = flociActionSchema.safeParse(raw)
            if (!parsed.success) {
              throw new FlociFailure('invalid')
            }
            return { ok: true, runtime: await requireProvider(event.sender).act(parsed.data) }
          }
          const parsed = flociReadSchema.safeParse(raw)
          if (!parsed.success) {
            throw new FlociFailure('invalid')
          }
          const owner = requireProvider(event.sender)
          const context = await owner.selected(parsed.data.projectId, parsed.data.targetId)
          const instance = await owner.controller.ensure(parsed.data.targetId)
          context.assertAdmission()
          return {
            ok: true,
            runtime: parsed.data.refresh
              ? await owner.controller.refresh(parsed.data.targetId)
              : owner.controller.view(instance)
          }
        } catch (error) {
          const code = error instanceof FlociFailure ? error.code : 'storage'
          return { ok: false, code, message: flociMessages[code] }
        }
      }
    )
  }
  setFlociEnvResolver((projectId, targetId) => {
    if (!provider) {
      throw new FlociFailure('owner-changed')
    }
    return provider.targetEnv(projectId, targetId)
  })
  for (const operation of ['targetEnv', 'listResources'] as const) {
    ipcMain.handle(`bastionCloud:${operation}`, async (event, raw: unknown) => {
      try {
        if (event.senderFrame !== event.sender.mainFrame) {
          throw new FlociFailure('owner-changed')
        }
        const parsed = flociResourcesRequestSchema.safeParse(raw)
        if (!parsed.success) {
          throw new FlociFailure('invalid')
        }
        const owner = requireProvider(event.sender)
        return operation === 'targetEnv'
          ? { ok: true, env: await owner.targetEnv(parsed.data.projectId, parsed.data.targetId) }
          : {
              ok: true,
              resources: await owner.listResources(parsed.data.projectId, parsed.data.targetId)
            }
      } catch (error) {
        const code = error instanceof FlociFailure ? error.code : 'storage'
        return { ok: false, code, message: flociMessages[code] }
      }
    })
  }
  ipcMain.handle('bastionCloud:captureBinding', (event, raw: unknown) => {
    if (event.senderFrame !== event.sender.mainFrame) {
      throw new FlociFailure('owner-changed')
    }
    const { projectId } = z
      .object({ projectId: z.string().min(1).max(4096) })
      .strict()
      .parse(raw)
    return requireProvider(event.sender).captureProject(projectId)
  })
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
    setCloudBindingAuthority(undefined)
    setFlociEnvResolver(undefined)
    provider?.close()
    catalog?.close()
    catalog = undefined
  })
}
