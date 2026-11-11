import { randomUUID } from 'node:crypto'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { dirname, join } from 'node:path'

export const WORKSPACE_HANDOFF_ENV = 'BASTION_WORKSPACE_HANDOFF'
export type WorkspaceWindowBounds = {
  x: number
  y: number
  width: number
  height: number
  maximized: boolean
}
export type WorkspaceHandoffDecision = 'released' | 'cancelled'

const HANDOFF_NAME = /^[0-9a-f-]{36}\.json$/
const STALE_MS = 10 * 60_000

function directory(root: string): string {
  const path = join(root, 'bastion-project-workspaces', 'handoffs')
  mkdirSync(path, { recursive: true, mode: 0o700 })
  if (lstatSync(path).isSymbolicLink()) {
    throw new Error('Invalid workspace handoff directory.')
  }
  return path
}

// Each party writes its own file exactly once, so a late arrival can never contradict a decision.
const readyPath = (path: string): string => path.replace(/\.json$/, '.ready')
// A starting destination refreshes this so a slow but live start is not mistaken for a failure.
const alivePath = (path: string): string => path.replace(/\.json$/, '.alive')
const HEARTBEAT_MS = 2_000
export const HANDOFF_STALE_MS = 15_000
export const HANDOFF_MAX_WAIT_MS = 180_000
export const decisionPath = (path: string): string => path.replace(/\.json$/, '.decision')

function writeOnce(path: string, contents: string): boolean {
  try {
    writeFileSync(path, contents, { mode: 0o600, flag: 'wx' })
    return true
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST') {
      return false
    }
    throw error
  }
}

export function readWorkspaceHandoffDecision(path: string): WorkspaceHandoffDecision | null {
  try {
    const value = readFileSync(decisionPath(path), 'utf8')
    return value === 'released' || value === 'cancelled' ? value : null
  } catch {
    return null
  }
}

function readBounds(path: string): WorkspaceWindowBounds | null {
  try {
    const value: unknown = JSON.parse(readFileSync(path, 'utf8'))
    if (!value || typeof value !== 'object' || !('bounds' in value)) {
      return null
    }
    const b = value.bounds
    if (!b || typeof b !== 'object') {
      return null
    }
    const x = Reflect.get(b, 'x')
    const y = Reflect.get(b, 'y')
    const width = Reflect.get(b, 'width')
    const height = Reflect.get(b, 'height')
    const maximized = Reflect.get(b, 'maximized')
    if (
      typeof x !== 'number' ||
      typeof y !== 'number' ||
      typeof width !== 'number' ||
      typeof height !== 'number' ||
      typeof maximized !== 'boolean' ||
      ![x, y, width, height].every(Number.isFinite) ||
      width < 200 ||
      height < 150
    ) {
      return null
    }
    return { x, y, width, height, maximized }
  } catch {
    return null
  }
}

async function waitUntil<T>(check: () => T | null, timeout: number): Promise<T | null> {
  const until = Date.now() + timeout
  do {
    const value = check()
    if (value !== null) {
      return value
    }
    await new Promise((resolve) => setTimeout(resolve, 25))
  } while (Date.now() < until)
  return null
}

function removeHandoff(path: string): void {
  for (const file of [path, readyPath(path), decisionPath(path), alivePath(path)]) {
    rmSync(file, { force: true })
  }
}

function sweepStaleHandoffs(parent: string): void {
  for (const name of readdirSync(parent)) {
    const file = join(parent, name)
    try {
      if (Date.now() - statSync(file).mtimeMs > STALE_MS) {
        rmSync(file, { force: true })
      }
    } catch {
      // A concurrent switch may already have removed it.
    }
  }
}

export function createWorkspaceHandoff(root: string, bounds: WorkspaceWindowBounds) {
  const parent = directory(root)
  sweepStaleHandoffs(parent)
  const path = join(parent, `${randomUUID()}.json`)
  writeFileSync(path, JSON.stringify({ bounds }), { mode: 0o600, flag: 'wx' })
  let decided: WorkspaceHandoffDecision | null = null
  const decide = (decision: WorkspaceHandoffDecision): WorkspaceHandoffDecision => {
    if (decided) {
      return decided
    }
    decided = writeOnce(decisionPath(path), decision)
      ? decision
      : (readWorkspaceHandoffDecision(path) ?? decision)
    return decided
  }
  return {
    path,
    /**
     * True once the destination has loaded; it stays hidden until release(). A destination must
     * show life within startTimeout, then keep its heartbeat fresh until ready or maxWait.
     */
    waitUntilReady: async (
      startTimeout: number,
      maxWait = HANDOFF_MAX_WAIT_MS,
      staleAfter = HANDOFF_STALE_MS
    ): Promise<boolean> => {
      const startedAt = Date.now()
      const outcome = await waitUntil(() => {
        if (existsSync(readyPath(path))) {
          return true
        }
        const now = Date.now()
        let alive: number | null = null
        try {
          alive = statSync(alivePath(path)).mtimeMs
        } catch {
          alive = null
        }
        if (alive === null) {
          return now - startedAt > startTimeout ? false : null
        }
        return now - alive > staleAfter || now - startedAt > maxWait ? false : null
      }, maxWait)
      return outcome === true
    },
    release: (): WorkspaceHandoffDecision => decide('released'),
    cancel: (): WorkspaceHandoffDecision => decide('cancelled')
  }
}

export function acceptWorkspaceHandoff(root: string, env: NodeJS.ProcessEnv = process.env) {
  const path = env[WORKSPACE_HANDOFF_ENV]
  delete env[WORKSPACE_HANDOFF_ENV]
  if (!path) {
    return null
  }
  const parent = directory(root)
  if (dirname(path) !== parent || !HANDOFF_NAME.test(path.slice(parent.length + 1))) {
    return null
  }
  if (
    !existsSync(path) ||
    lstatSync(path).isSymbolicLink() ||
    realpathSync(dirname(path)) !== realpathSync(parent) ||
    readWorkspaceHandoffDecision(path) !== null
  ) {
    return null
  }
  const bounds = readBounds(path)
  if (!bounds) {
    return null
  }
  let heartbeat: ReturnType<typeof setInterval> | null = null
  const stopHeartbeat = (): void => {
    if (heartbeat) {
      clearInterval(heartbeat)
      heartbeat = null
    }
  }
  return {
    bounds,
    /** Tell the waiting source this destination is alive while it starts. */
    startHeartbeat: (): void => {
      const beat = (): void => {
        if (readWorkspaceHandoffDecision(path) !== null || !existsSync(path)) {
          stopHeartbeat()
          return
        }
        writeFileSync(alivePath(path), String(Date.now()), { mode: 0o600 })
      }
      beat()
      heartbeat ??= setInterval(beat, HEARTBEAT_MS)
      heartbeat.unref?.()
    },
    /** Signal readiness once, then learn whether to show this window or close it. */
    markReady: async (timeout: number): Promise<WorkspaceHandoffDecision | null> => {
      writeOnce(readyPath(path), 'ready')
      const decision = await waitUntil(() => readWorkspaceHandoffDecision(path), timeout)
      stopHeartbeat()
      removeHandoff(path)
      return decision
    }
  }
}
