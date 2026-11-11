import { app, BrowserWindow, ipcMain } from 'electron'
import { showWindowWithoutStealingFocus } from '../../window/foreground-activation-policy'
import { quitProcess } from '../../startup/process-quit-request'
import { acceptWorkspaceHandoff, type WorkspaceWindowBounds } from './workspace-handoff'
import { readProjectWorkspaceContext } from './workspace-context'

const DECISION_TIMEOUT_MS = 35_000
// The source gives up at 30s; never leave a destination with no window if its source vanished.
const ORPHAN_REVEAL_MS = 45_000

let holdingReveal = false

/** While true, the initial reveal is deferred until the source window has stepped aside. */
export function isWorkspaceRevealHeld(): boolean {
  return holdingReveal
}

function place(window: BrowserWindow, { maximized, ...bounds }: WorkspaceWindowBounds): void {
  window.setBounds(bounds)
  if (maximized) {
    window.maximize()
  } else if (window.isMaximized()) {
    window.unmaximize()
  }
}

function reveal(window: BrowserWindow | null): void {
  holdingReveal = false
  if (!window || window.isDestroyed()) {
    return
  }
  window.webContents.setBackgroundThrottling(true)
  showWindowWithoutStealingFocus(window)
}

export function registerProjectWorkspaceArrival(): void {
  const context = readProjectWorkspaceContext()
  const arrival = context ? acceptWorkspaceHandoff(context.baseRoot) : null
  console.log('[workspace-transition] arrival-context', {
    handoff: Boolean(arrival),
    pid: process.pid
  })
  if (!arrival) {
    ipcMain.handle('bastionWorkspaces:ready', () => undefined)
    return
  }
  holdingReveal = true
  let target: BrowserWindow | null = null
  // A hidden destination must still hydrate at full speed.
  app.on('browser-window-created', (_event, window) => {
    if (holdingReveal && !target) {
      target = window
      window.webContents.setBackgroundThrottling(false)
    }
  })
  const orphanTimer = setTimeout(
    () => reveal(target ?? BrowserWindow.getAllWindows()[0] ?? null),
    ORPHAN_REVEAL_MS
  )
  orphanTimer.unref?.()
  let completed = false
  ipcMain.handle('bastionWorkspaces:ready', async (event) => {
    if (completed) {
      return
    }
    completed = true
    const window = BrowserWindow.fromWebContents(event.sender)
    target = window ?? target
    console.log('[workspace-transition] arrival-painted', { pid: process.pid })
    if (window) {
      place(window, arrival.bounds)
    }
    const decision = await arrival.markReady(DECISION_TIMEOUT_MS)
    clearTimeout(orphanTimer)
    if (decision === 'cancelled') {
      console.log('[workspace-transition] arrival-cancelled', { pid: process.pid })
      holdingReveal = false
      quitProcess()
      return
    }
    reveal(window)
    console.log('[workspace-transition] arrival-shown', { pid: process.pid, decision })
  })
}
