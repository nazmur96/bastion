import { randomUUID } from 'node:crypto'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  unlinkSync,
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
type HandoffRecord = { bounds: WorkspaceWindowBounds; state: 'waiting' | 'claimed' | 'ready' }

function directory(root: string): string {
  const path = join(root, 'bastion-project-workspaces', 'handoffs')
  mkdirSync(path, { recursive: true, mode: 0o700 })
  if (lstatSync(path).isSymbolicLink()) {
    throw new Error('Invalid workspace handoff directory.')
  }
  return path
}
function read(path: string): HandoffRecord | null {
  try {
    const value: unknown = JSON.parse(readFileSync(path, 'utf8'))
    if (!value || typeof value !== 'object' || !('bounds' in value) || !('state' in value)) {
      return null
    }
    const b = value.bounds
    if (
      !b ||
      typeof b !== 'object' ||
      !('x' in b) ||
      !('y' in b) ||
      !('width' in b) ||
      !('height' in b) ||
      !('maximized' in b)
    ) {
      return null
    }
    if (
      typeof b.x !== 'number' ||
      typeof b.y !== 'number' ||
      typeof b.width !== 'number' ||
      typeof b.height !== 'number' ||
      typeof b.maximized !== 'boolean' ||
      ![b.x, b.y, b.width, b.height].every(Number.isFinite) ||
      b.width < 200 ||
      b.height < 150
    ) {
      return null
    }
    if (value.state !== 'waiting' && value.state !== 'claimed' && value.state !== 'ready') {
      return null
    }
    return {
      bounds: { x: b.x, y: b.y, width: b.width, height: b.height, maximized: b.maximized },
      state: value.state
    }
  } catch {
    return null
  }
}
async function waitUntil(check: () => boolean, timeout: number): Promise<boolean> {
  const until = Date.now() + timeout
  do {
    if (check()) {
      return true
    }
    await new Promise((resolve) => setTimeout(resolve, 25))
  } while (Date.now() < until)
  return false
}
export function createWorkspaceHandoff(root: string, bounds: WorkspaceWindowBounds) {
  const path = join(directory(root), `${randomUUID()}.json`)
  writeFileSync(path, JSON.stringify({ bounds, state: 'waiting' }), { mode: 0o600, flag: 'wx' })
  return {
    path,
    waitUntilReady: (timeout: number) => waitUntil(() => read(path)?.state === 'ready', timeout),
    release: (): void => {
      if (existsSync(path)) {
        unlinkSync(path)
      }
    }
  }
}
export function acceptWorkspaceHandoff(root: string, env: NodeJS.ProcessEnv = process.env) {
  const path = env[WORKSPACE_HANDOFF_ENV]
  delete env[WORKSPACE_HANDOFF_ENV]
  if (!path) {
    return null
  }
  const parent = directory(root)
  if (dirname(path) !== parent || !/^[0-9a-f-]{36}\.json$/.test(path.slice(parent.length + 1))) {
    return null
  }
  if (
    !existsSync(path) ||
    lstatSync(path).isSymbolicLink() ||
    realpathSync(dirname(path)) !== realpathSync(parent)
  ) {
    return null
  }
  const record = read(path)
  if (!record || record.state !== 'waiting') {
    return null
  }
  writeFileSync(path, JSON.stringify({ ...record, state: 'claimed' }), { mode: 0o600 })
  return {
    bounds: record.bounds,
    markReady: (timeout: number): Promise<boolean> => {
      if (read(path)?.state !== 'claimed') {
        return Promise.resolve(false)
      }
      writeFileSync(path, JSON.stringify({ ...record, state: 'ready' }), { mode: 0o600 })
      return waitUntil(() => !existsSync(path), timeout)
    }
  }
}
