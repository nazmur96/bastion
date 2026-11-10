import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import {
  acceptWorkspaceHandoff,
  createWorkspaceHandoff,
  WORKSPACE_HANDOFF_ENV
} from './workspace-handoff'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

it('keeps the leaving window until the arriving one is painted, then hands over its bounds', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bastion-handoff-'))
  roots.push(root)
  const bounds = { x: 10, y: 20, width: 1300, height: 700, maximized: false }
  const leaving = createWorkspaceHandoff(root, bounds)
  const env: NodeJS.ProcessEnv = { [WORKSPACE_HANDOFF_ENV]: leaving.path }
  const arriving = acceptWorkspaceHandoff(root, env)
  expect(env[WORKSPACE_HANDOFF_ENV]).toBeUndefined()
  expect(arriving?.bounds).toEqual(bounds)

  let ready = false
  const waiting = leaving.waitUntilReady(2000).then((value) => (ready = value))
  await new Promise((resolve) => setTimeout(resolve, 150))
  expect(ready).toBe(false)
  const released = arriving?.markReady(2000)
  await waiting
  expect(ready).toBe(true)
  leaving.release()
  expect(await released).toBe(true)
  expect(existsSync(leaving.path)).toBe(false)
})

it('ignores a handoff outside the catalog or one that was already used', () => {
  const root = mkdtempSync(join(tmpdir(), 'bastion-handoff-'))
  roots.push(root)
  const foreign = join(root, 'elsewhere.json')
  writeFileSync(foreign, JSON.stringify({ x: 0, y: 0, width: 900, height: 600, maximized: false }))
  expect(acceptWorkspaceHandoff(root, { [WORKSPACE_HANDOFF_ENV]: foreign })).toBeNull()
  const stale = createWorkspaceHandoff(root, {
    x: 0,
    y: 0,
    width: 900,
    height: 600,
    maximized: true
  })
  stale.release()
  rmSync(stale.path, { force: true })
  expect(acceptWorkspaceHandoff(root, { [WORKSPACE_HANDOFF_ENV]: stale.path })).toBeNull()
})

it('gives up waiting instead of leaving the user without a window', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bastion-handoff-'))
  roots.push(root)
  const leaving = createWorkspaceHandoff(root, {
    x: 0,
    y: 0,
    width: 900,
    height: 600,
    maximized: false
  })
  expect(await leaving.waitUntilReady(200)).toBe(false)
})

it('rejects a late arrival after its source cancelled the handoff', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bastion-handoff-'))
  roots.push(root)
  const leaving = createWorkspaceHandoff(root, {
    x: 0,
    y: 0,
    width: 900,
    height: 600,
    maximized: false
  })
  const arriving = acceptWorkspaceHandoff(root, { [WORKSPACE_HANDOFF_ENV]: leaving.path })
  leaving.release()
  expect(await arriving?.markReady(200)).toBe(false)
  expect(existsSync(leaving.path)).toBe(false)
})
