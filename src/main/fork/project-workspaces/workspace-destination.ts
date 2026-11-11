import { app, BrowserWindow, type WebContents } from 'electron'
import { spawnProcess } from '@orca/process-host'
import { runWithLaunchPath } from '../../startup/hydrate-shell-path'
import { removeAppImageRuntimeEnv } from '../../pty/appimage-terminal-env'
import { requestDevWorkspaceRestart } from './workspace-dev-restart'
import { createWorkspaceHandoff, WORKSPACE_HANDOFF_ENV } from './workspace-handoff'
import { projectWorkspaceRelaunchArgs, readProjectWorkspaceContext } from './workspace-context'

const READY_TIMEOUT_MS = 30_000

/**
 * A FUSE-mounted AppImage's executable vanishes with this process, so relaunch the image itself.
 * Extracting launchers such as NixOS appimage-run keep the executable, and re-running the image there
 * starts a sandbox that dies with this process, so they relaunch the executable directly.
 */
export function packagedWorkspaceLaunch(
  target: string,
  handoffPath: string,
  env: NodeJS.ProcessEnv = process.env,
  argv: readonly string[] = process.argv,
  execPath: string = process.execPath
): { program: string; args: string[]; env: Record<string, string> } {
  const childEnv: Record<string, string> = {}
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === 'string') {
      childEnv[key] = value
    }
  }
  const temporaryMount = /(^|\/)\.mount_[^/]+\/?$/.test(env.APPDIR ?? '')
  const appImage = process.platform === 'linux' && temporaryMount ? env.APPIMAGE : undefined
  if (appImage) {
    removeAppImageRuntimeEnv(childEnv)
  }
  childEnv[WORKSPACE_HANDOFF_ENV] = handoffPath
  return {
    program: appImage || execPath,
    args: projectWorkspaceRelaunchArgs(argv.slice(1), target),
    env: childEnv
  }
}

/** Keep the current window until the destination has loaded, then hide it before releasing. */
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
    ...window.getNormalBounds(),
    maximized: window.isMaximized()
  })
  console.log('[workspace-transition] destination-start', { target, pid: process.pid })
  let launched: { kill: () => void } | null = null
  if (!requestDevWorkspaceRestart(target, handoff.path)) {
    if (!app.isPackaged) {
      handoff.cancel()
      throw new Error('Start the development app with pnpm dev to switch workspaces.')
    }
    const launch = packagedWorkspaceLaunch(target, handoff.path)
    const child = runWithLaunchPath(() =>
      spawnProcess({ ...launch, stdio: 'ignore', detached: true })
    )
    child.on('error', (error) => console.warn('[workspace-transition] launch-error', error.name))
    child.unref()
    launched = { kill: () => child.kill() }
  }
  if (!(await handoff.waitUntilReady(READY_TIMEOUT_MS))) {
    // Write-once: a destination that becomes ready now still reads cancelled and quits.
    handoff.cancel()
    launched?.kill()
    console.log('[workspace-transition] destination-cancelled', { target })
    throw new Error(
      'The destination could not open. Your current workspace is still available; try again.'
    )
  }
  // Step aside before the destination appears; tiling desktops would otherwise split the screen.
  window.hide()
  handoff.release()
  console.log('[workspace-transition] destination-released', { target })
}
