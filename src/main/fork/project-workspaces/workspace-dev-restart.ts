import { app } from 'electron'
import { writeFileSync } from 'node:fs'

/** Let pnpm dev reopen Electron with its renderer server; app.relaunch alone loses that server. */
export function requestDevWorkspaceRestart(target: string): boolean {
  const file = process.env.BASTION_DEV_RESTART_FILE
  const nonce = process.env.BASTION_DEV_RESTART_NONCE
  if (app.isPackaged || !file || !nonce) {
    return false
  }
  writeFileSync(file, JSON.stringify({ nonce, reason: 'project-workspace-switch', target }), {
    mode: 0o600
  })
  return true
}
