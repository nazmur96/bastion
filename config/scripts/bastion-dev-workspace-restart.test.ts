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
    expect(consumeDevWorkspaceRestart(env)).toBeNull()
    const request = (nonce: string, target: string): void =>
      writeFileSync(
        env.BASTION_DEV_RESTART_FILE,
        JSON.stringify({ nonce, reason: 'project-workspace-switch', target })
      )
    request('foreign', 'home')
    expect(consumeDevWorkspaceRestart(env)).toBeNull()
    request(env.BASTION_DEV_RESTART_NONCE, '../escape')
    expect(consumeDevWorkspaceRestart(env)).toBeNull()
    request(env.BASTION_DEV_RESTART_NONCE, 'home')
    expect(consumeDevWorkspaceRestart(env)).toBe('home')
    expect(consumeDevWorkspaceRestart(env)).toBeNull()
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
