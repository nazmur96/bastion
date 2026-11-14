import { admitCloudChange } from '../cloud/cloud-binding-authority'
import { isTrustedUIRenderer } from '../../ipc/ui'
import { app, ipcMain } from 'electron'
import { z } from 'zod'
import {
  changeCommandSchema,
  changeIntentSchema,
  changeEntranceSchema,
  changeScopeSchema
} from '../../../shared/fork-changes/change-contract'
import { readProjectWorkspaceContext } from '../project-workspaces/workspace-context'
import { ChangeLedger } from './change-ledger'

export function registerChangeHandlers(): void {
  let ledger: ChangeLedger | undefined
  const open = (): ChangeLedger => {
    const context = readProjectWorkspaceContext()
    if (!context?.workspace || context.incognito) {
      throw new Error('Change records require a project workspace.')
    }
    if (!ledger) {
      ledger = new ChangeLedger(context.dataRoot)
      ledger.interruptRunning()
    }
    return ledger
  }
  const watched = new Map<number, Set<string>>()
  ipcMain.handle('bastionChanges:ensure', (event, args: unknown) => {
    const parsed = z
      .object({
        scope: changeScopeSchema,
        entrance: changeEntranceSchema,
        intent: changeIntentSchema.optional()
      })
      .strict()
      .parse(args)
    const active = open()
    if (!watched.has(event.sender.id)) {
      const senderId = event.sender.id
      const runIds = new Set<string>()
      watched.set(senderId, runIds)
      event.sender.once('destroyed', () => {
        watched.delete(senderId)
        ledger?.interruptRunning(runIds)
      })
      event.sender.on('render-process-gone', () => ledger?.interruptRunning(runIds))
      // Positional url/isInPlace/isMainFrame arguments are deprecated; read the event details.
      event.sender.on('did-start-navigation', (details) => {
        if (details.isMainFrame && !details.isSameDocument) {
          ledger?.interruptRunning(runIds)
        }
      })
    }
    return active.ensure(parsed.scope, parsed.entrance, parsed.intent)
  })
  ipcMain.handle('bastionChanges:list', (_event, args: unknown) => {
    const parsed = z
      .object({ projectId: z.string().min(1).max(4096) })
      .strict()
      .parse(args)
    return open().list(parsed.projectId)
  })
  ipcMain.handle('bastionChanges:command', async (event, args: unknown) => {
    if (!isTrustedUIRenderer(event.sender) || event.senderFrame !== event.sender.mainFrame) {
      throw new Error('Untrusted change sender.')
    }
    const parsed = z
      .object({
        id: z.string().uuid(),
        revision: z.number().int().nonnegative(),
        command: changeCommandSchema
      })
      .strict()
      .parse(args)
    const runIds = watched.get(event.sender.id)
    if (!runIds) {
      throw new Error('Open the change in this window before updating it.')
    }
    if (
      'runId' in parsed.command &&
      parsed.command.kind !== 'interrupt' &&
      !runIds.has(parsed.command.runId)
    ) {
      throw new Error('This window does not own the running attempt.')
    }
    const active = open()
    const record = active.get(parsed.id)
    const result = await admitCloudChange(
      record,
      parsed.command,
      () => active.command(parsed.id, parsed.revision, parsed.command),
      () => {
        active.command(record.id, record.revision, { kind: 'invalidate' })
      }
    )
    if (parsed.command.kind === 'start') {
      const run = result.runs.at(-1)
      if (run) {
        runIds.add(run.id)
      }
    }
    return result
  })
  app.once('will-quit', () => {
    ledger?.interruptRunning()
    ledger?.close()
    ledger = undefined
  })
}
