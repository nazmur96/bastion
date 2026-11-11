import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import {
  acceptWorkspaceHandoff,
  createWorkspaceHandoff,
  decisionPath,
  WORKSPACE_HANDOFF_ENV
} from './workspace-handoff'

const roots: string[] = []
function temporary(): string {
  const root = mkdtempSync(join(tmpdir(), 'bastion-handoff-'))
  roots.push(root)
  return root
}
afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})
const bounds = { x: 10, y: 20, width: 1300, height: 700, maximized: false }

it('keeps the destination hidden until the loaded arrival is released, then hands over bounds', async () => {
  const root = temporary()
  const leaving = createWorkspaceHandoff(root, bounds)
  const env: NodeJS.ProcessEnv = { [WORKSPACE_HANDOFF_ENV]: leaving.path }
  const arriving = acceptWorkspaceHandoff(root, env)
  expect(env[WORKSPACE_HANDOFF_ENV]).toBeUndefined()
  expect(arriving?.bounds).toEqual(bounds)
  expect(await leaving.waitUntilReady(100)).toBe(false)
  const decision = arriving?.markReady(2000)
  expect(await leaving.waitUntilReady(2000)).toBe(true)
  expect(leaving.release()).toBe('released')
  expect(await decision).toBe('released')
  expect(existsSync(leaving.path)).toBe(false)
})

it('tells a late arrival to quit after its source cancelled, even when readiness races the decision', async () => {
  const root = temporary()
  const leaving = createWorkspaceHandoff(root, bounds)
  const arriving = acceptWorkspaceHandoff(root, { [WORKSPACE_HANDOFF_ENV]: leaving.path })
  expect(await leaving.waitUntilReady(50)).toBe(false)
  expect(leaving.cancel()).toBe('cancelled')
  // A release attempted after the decision cannot overturn it.
  expect(leaving.release()).toBe('cancelled')
  expect(await arriving?.markReady(2000)).toBe('cancelled')
})

it('ignores a foreign or already decided handoff', () => {
  const root = temporary()
  const foreign = join(root, 'elsewhere.json')
  writeFileSync(foreign, JSON.stringify({ bounds }))
  expect(acceptWorkspaceHandoff(root, { [WORKSPACE_HANDOFF_ENV]: foreign })).toBeNull()
  const decided = createWorkspaceHandoff(root, bounds)
  decided.cancel()
  expect(existsSync(decisionPath(decided.path))).toBe(true)
  expect(acceptWorkspaceHandoff(root, { [WORKSPACE_HANDOFF_ENV]: decided.path })).toBeNull()
})

it('reports no decision when its source vanished instead of waiting forever', async () => {
  const root = temporary()
  const leaving = createWorkspaceHandoff(root, bounds)
  const arriving = acceptWorkspaceHandoff(root, { [WORKSPACE_HANDOFF_ENV]: leaving.path })
  expect(await arriving?.markReady(150)).toBeNull()
})

it('keeps waiting for a slow destination while its heartbeat stays fresh', async () => {
  const root = temporary()
  const leaving = createWorkspaceHandoff(root, bounds)
  const arriving = acceptWorkspaceHandoff(root, { [WORKSPACE_HANDOFF_ENV]: leaving.path })
  arriving?.startHeartbeat()
  // Past the 100ms start limit, yet alive: the source must not give up.
  const waiting = leaving.waitUntilReady(100, 3000, 1000)
  await new Promise((resolve) => setTimeout(resolve, 400))
  const decision = arriving?.markReady(2000)
  expect(await waiting).toBe(true)
  leaving.release()
  expect(await decision).toBe('released')
})

it('gives up quickly on a destination that never shows life', async () => {
  const root = temporary()
  const leaving = createWorkspaceHandoff(root, bounds)
  const startedAt = Date.now()
  expect(await leaving.waitUntilReady(150, 5000, 1000)).toBe(false)
  expect(Date.now() - startedAt).toBeLessThan(1000)
})
