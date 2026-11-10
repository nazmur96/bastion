import { spawn } from 'node:child_process'
import { resolveDevInstancePorts, announceDevInstance } from './dev-instance-isolation.mjs'
import { randomUUID } from 'node:crypto'
import { readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'

/** One runner owns this request path; catalog selection remains the startup authority. */
export function devWorkspaceRestartEnvironment(repoRoot, pid = process.pid) {
  return {
    BASTION_DEV_RESTART_FILE: join(repoRoot, 'out', `bastion-workspace-restart-${pid}.json`),
    BASTION_DEV_RESTART_NONCE: randomUUID()
  }
}

export function consumeDevWorkspaceRestart(env) {
  const file = env.BASTION_DEV_RESTART_FILE
  if (!file || !env.BASTION_DEV_RESTART_NONCE) {
    return false
  }
  try {
    const request = JSON.parse(readFileSync(file, 'utf8'))
    return (
      request.nonce === env.BASTION_DEV_RESTART_NONCE &&
      request.reason === 'project-workspace-switch'
    )
  } catch {
    return false
  } finally {
    rmSync(file, { force: true })
  }
}

export async function devWorkspaceForwardedArgs(forwardedRaw, repoRoot, profile) {
  const ports = await resolveDevInstancePorts({
    forwardedArgs: forwardedRaw,
    instanceKey: process.env.ORCA_DEV_INSTANCE_KEY || repoRoot
  })
  announceDevInstance({ repoRoot, profile, ...ports })
  return ['dev', ...forwardedRaw, ...ports.forwardedExtras]
}

export function spawnDevWorkspaceChild(executable, args, env, onError, onExit) {
  const child = spawn(executable, args, {
    stdio: 'inherit',
    env,
    detached: process.platform !== 'win32'
  })
  child.on('error', onError)
  child.on('exit', onExit)
  return child
}

export function terminateDevWorkspaceChild(child, signal) {
  if (!child.pid) {
    return
  }

  if (process.platform === 'win32') {
    const taskkill = spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
      stdio: 'ignore',
      windowsHide: true
    })
    taskkill.unref()
    return
  }

  try {
    process.kill(-child.pid, signal)
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? error.code : null
    if (code !== 'ESRCH') {
      throw error
    }
  }
}
