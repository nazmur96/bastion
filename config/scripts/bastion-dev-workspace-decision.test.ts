import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import {
  devMainBuildIsCurrent,
  watchDevWorkspaceDecision
} from './bastion-dev-workspace-restart.mjs'

it('stops a destination once its source cancels the switch', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bastion-decision-'))
  try {
    const handoff = join(root, 'a.json')
    writeFileSync(handoff, '{}')
    const cancelled = vi.fn()
    watchDevWorkspaceDecision(handoff, cancelled)
    writeFileSync(join(root, 'a.decision'), 'cancelled')
    await vi.waitFor(() => expect(cancelled).toHaveBeenCalledOnce())
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

it('reuses built main and preload only while no source is newer', () => {
  const root = mkdtempSync(join(tmpdir(), 'bastion-build-'))
  try {
    for (const dir of ['out/main', 'out/preload', 'src/main', 'src/preload', 'src/shared']) {
      mkdirSync(join(root, dir), { recursive: true })
    }
    const old = new Date(Date.now() - 60_000)
    for (const file of ['src/main/a.ts', 'src/preload/b.ts', 'src/shared/c.ts']) {
      writeFileSync(join(root, file), '')
      utimesSync(join(root, file), old, old)
    }
    writeFileSync(join(root, 'out/main/index.js'), '')
    writeFileSync(join(root, 'out/preload/index.js'), '')
    expect(devMainBuildIsCurrent(root)).toBe(true)
    writeFileSync(join(root, 'src/main/a.ts'), 'changed')
    utimesSync(join(root, 'src/main/a.ts'), new Date(), new Date(Date.now() + 5_000))
    expect(devMainBuildIsCurrent(root)).toBe(false)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
