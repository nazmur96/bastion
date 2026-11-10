import { app, BrowserWindow, type WebContents } from 'electron'
import { spawnProcess } from '@orca/process-host'
import { runWithLaunchPath } from '../../startup/hydrate-shell-path'
import { requestDevWorkspaceRestart } from './workspace-dev-restart'
import { createWorkspaceHandoff, WORKSPACE_HANDOFF_ENV } from './workspace-handoff'
import { projectWorkspaceRelaunchArgs, readProjectWorkspaceContext } from './workspace-context'

/** Keep the current workbench alive until the destination has rendered its own namespace. */
export async function openProjectWorkspaceDestination(
  sender: WebContents,
  target: string
): Promise<void> {
  const context = readProjectWorkspaceContext()
  const window = BrowserWindow.fromWebContents(sender)
  if (!context || !window) {
    throw new Error('Workspace window is unavailable.')
  }
  const handoff = createWorkspaceHandoff(context.baseRoot, {
    ...window.getBounds(),
    maximized: window.isMaximized()
  })
  console.log('[workspace-transition] destination-start', { target, pid: process.pid })
  try {
    if (!requestDevWorkspaceRestart(target, handoff.path)) {
      if (!app.isPackaged) {
        throw new Error('Start the development app with pnpm dev to switch workspaces.')
      }
      const child = runWithLaunchPath(() =>
        spawnProcess({
          program: process.execPath,
          args: projectWorkspaceRelaunchArgs(process.argv.slice(1), target),
          env: { ...process.env, [WORKSPACE_HANDOFF_ENV]: handoff.path },
          stdio: 'ignore',
          detached: true
        })
      )
      child.on('error', (error) => console.warn('[workspace-transition] launch-error', error.name))
      child.unref()
    }
    if (!(await handoff.waitUntilReady(30_000))) {
      throw new Error(
        'The destination could not open. Your current workspace is still available; try again.'
      )
    }
    console.log('[workspace-transition] destination-ready', { target })
  } finally {
    handoff.release()
  }
}
