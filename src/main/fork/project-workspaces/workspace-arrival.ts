import { BrowserWindow, ipcMain } from 'electron'
import { acceptWorkspaceHandoff } from './workspace-handoff'
import { readProjectWorkspaceContext } from './workspace-context'

export function registerProjectWorkspaceArrival(): void {
  const context = readProjectWorkspaceContext()
  const arrival = context ? acceptWorkspaceHandoff(context.baseRoot) : null
  console.log('[workspace-transition] arrival-context', {
    handoff: Boolean(arrival),
    pid: process.pid
  })
  let completed = false
  ipcMain.handle('bastionWorkspaces:ready', async (event) => {
    if (!arrival || completed) {
      return
    }
    completed = true
    console.log('[workspace-transition] arrival-painted', { pid: process.pid })
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) {
      return
    }
    const { maximized, ...bounds } = arrival.bounds
    window.setBounds(bounds)
    if (maximized) {
      window.maximize()
    } else if (window.isMaximized()) {
      window.unmaximize()
    }
    if (!(await arrival.markReady(30_000))) {
      window.close()
    }
  })
}
