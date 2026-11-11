import { spawn } from 'node:child_process'
import { announceDevInstance } from './dev-instance-isolation.mjs'
import { resolveDevWorkspacePorts } from './bastion-dev-workspace-ports.mjs'
import { randomUUID } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'

/** One runner owns this request path; catalog selection remains the startup authority. */
export function devWorkspaceRestartEnvironment(repoRoot, pid = process.pid) {
  return {
    BASTION_DEV_RESTART_FILE: join(repoRoot, 'out', `bastion-workspace-restart-${pid}.json`),
    BASTION_DEV_RESTART_NONCE: randomUUID()
  }
}

const LAUNCH_TARGET = /^(?:home|existing|workspace-[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})$/

/** Returns the workspace the next Electron child must open, or null when no switch was requested. */
export function consumeDevWorkspaceRestart(env) {
  const file = env.BASTION_DEV_RESTART_FILE
  if (!file || !env.BASTION_DEV_RESTART_NONCE) {
    return null
  }
  try {
    const request = JSON.parse(readFileSync(file, 'utf8'))
    return request.nonce === env.BASTION_DEV_RESTART_NONCE &&
      request.reason === 'project-workspace-switch' &&
      typeof request.target === 'string' &&
      LAUNCH_TARGET.test(request.target)
      ? request.target
      : null
  } catch {
    return null
  } finally {
    rmSync(file, { force: true })
  }
}

export async function devWorkspaceForwardedArgs(forwardedRaw, repoRoot, profile) {
  const ports = await resolveDevWorkspacePorts({
    forwardedArgs: forwardedRaw,
    repoRoot,
    profile
  })
  announceDevInstance({ repoRoot, profile, ...ports })
  // Reuse built main/preload only while they are newer than every source they are built from.
  const mode = devMainBuildIsCurrent(repoRoot) ? ['--rendererOnly'] : []
  return ['dev', ...mode, ...forwardedRaw, ...ports.forwardedExtras]
}

function newestMtime(directory) {
  let newest = 0
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      newest = Math.max(newest, newestMtime(path))
    } else if (entry.isFile()) {
      newest = Math.max(newest, statSync(path).mtimeMs)
    }
  }
  return newest
}

export function devMainBuildIsCurrent(repoRoot) {
  const outputs = ['out/main/index.js', 'out/preload/index.js'].map((file) => join(repoRoot, file))
  if (!outputs.every((file) => existsSync(file))) {
    return false
  }
  const built = Math.min(...outputs.map((file) => statSync(file).mtimeMs))
  return ['src/main', 'src/preload', 'src/shared'].every(
    (directory) => newestMtime(join(repoRoot, directory)) <= built
  )
}

/** Stop a destination whose source gave up, so the runner can accept the next switch. */
export function watchDevWorkspaceDecision(handoff, onCancelled) {
  const file = handoff.replace(/\.json$/, '.decision')
  const timer = setInterval(() => {
    let decision = null
    try {
      decision = readFileSync(file, 'utf8')
    } catch {
      // Removed by a destination that already read it, or not decided yet.
    }
    if (decision === 'cancelled') {
      clearInterval(timer)
      onCancelled()
    } else if (decision === 'released' || !existsSync(handoff)) {
      clearInterval(timer)
    }
  }, 100)
  timer.unref()
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

export function consumeDevWorkspaceHandoff(env, profile) {
  const file = env.BASTION_DEV_RESTART_FILE
  if (!file || !env.BASTION_DEV_RESTART_NONCE) {
    return null
  }
  try {
    const request = JSON.parse(readFileSync(file, 'utf8'))
    if (request.mode !== 'handoff') {
      return null
    }
    rmSync(file, { force: true })
    if (
      request.nonce !== env.BASTION_DEV_RESTART_NONCE ||
      typeof request.target !== 'string' ||
      !LAUNCH_TARGET.test(request.target) ||
      typeof request.handoff !== 'string' ||
      !/^[0-9a-f-]{36}\.json$/.test(basename(request.handoff)) ||
      dirname(request.handoff) !==
        join(profile.userDataPath, 'bastion-project-workspaces', 'handoffs')
    ) {
      return null
    }
    return { target: request.target, handoff: request.handoff }
  } catch {
    return null
  }
}

export function installDevWorkspaceHandoffPoll(env, profile, canStart, onStart) {
  const timer = setInterval(() => {
    if (!canStart()) {
      return
    }
    const request = consumeDevWorkspaceHandoff(env, profile)
    if (request) {
      void onStart(request).catch((error) =>
        console.error('[bastion-dev] Workspace handoff failed:', error.message)
      )
    }
  }, 100)
  timer.unref()
}

export async function prepareDevWorkspaceHandoff(request, forwardedRaw, repoRoot, profile) {
  delete process.env.ORCA_DEV_RENDERER_PORT
  process.env.BASTION_PROJECT_WORKSPACE_LAUNCH = request.target
  process.env.BASTION_WORKSPACE_HANDOFF = request.handoff
  return devWorkspaceForwardedArgs(forwardedRaw, repoRoot, profile)
}

export function devWorkspaceSignalExitCode(signal) {
  if (signal === 'SIGINT') {
    return 130
  }
  if (signal === 'SIGTERM') {
    return 143
  }
  return 1
}

export function shutdownDevWorkspaceChildren(child, previousChild, signal) {
  terminateDevWorkspaceChild(child, signal)
  if (previousChild) {
    terminateDevWorkspaceChild(previousChild, signal)
  }
  return setTimeout(() => terminateDevWorkspaceChild(child, 'SIGKILL'), 5000)
}

export function failDevWorkspaceChild(error, forcedKillTimer) {
  if (forcedKillTimer) {
    clearTimeout(forcedKillTimer)
  }
  console.error(error)
  process.exit(1)
}
