import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import {
  consumeDevWorkspaceRestart,
  devWorkspaceRestartEnvironment
} from './bastion-dev-workspace-restart.mjs'

it('accepts only the owning dev runner request and consumes it once', () => {
  const root = mkdtempSync(join(tmpdir(), 'bastion-dev-restart-'))
  try {
    mkdirSync(join(root, 'out'))
    const env = devWorkspaceRestartEnvironment(root, 123)
    expect(consumeDevWorkspaceRestart(env)).toBe(false)
    writeFileSync(
      env.BASTION_DEV_RESTART_FILE,
      JSON.stringify({ nonce: 'foreign', reason: 'project-workspace-switch' })
    )
    expect(consumeDevWorkspaceRestart(env)).toBe(false)
    writeFileSync(
      env.BASTION_DEV_RESTART_FILE,
      JSON.stringify({ nonce: env.BASTION_DEV_RESTART_NONCE, reason: 'project-workspace-switch' })
    )
    expect(consumeDevWorkspaceRestart(env)).toBe(true)
    expect(consumeDevWorkspaceRestart(env)).toBe(false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
