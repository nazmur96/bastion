import { app, ipcMain } from 'electron'
import { z } from 'zod'
import {
  changeCommandSchema,
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
      .object({ scope: changeScopeSchema, entrance: changeEntranceSchema })
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
      event.sender.on('did-start-navigation', (_navigation, _url, isInPlace, isMainFrame) => {
        if (isMainFrame && !isInPlace) {
          ledger?.interruptRunning(runIds)
        }
      })
    }
    return active.ensure(parsed.scope, parsed.entrance)
  })
  ipcMain.handle('bastionChanges:command', (event, args: unknown) => {
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
    const result = open().command(parsed.id, parsed.revision, parsed.command)
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
