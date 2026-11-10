import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { loadFocusSnapshot, saveFocusSnapshot } from './workbench-focus-snapshot'

const values = new Map<string, string>()
beforeEach(() => {
  values.clear()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key)
  })
})
afterEach(() => vi.unstubAllGlobals())

it('keeps a validated restoration point across a renderer reload and clears it on restore', () => {
  const snapshot = {
    worktreeId: 'folder:demo',
    target: 'terminal' as const,
    dockId: 'dock',
    share: 0.71,
    sidebarOpen: true,
    pathCollapsed: false,
    section: 'files' as const
  }
  saveFocusSnapshot(snapshot)
  expect(loadFocusSnapshot()).toEqual(snapshot)
  saveFocusSnapshot(null)
  expect(loadFocusSnapshot()).toBeNull()
})

it.each([
  'not json',
  '[]',
  '{"share":0.71}',
  JSON.stringify({
    worktreeId: 'demo',
    target: 'terminal',
    dockId: 'dock',
    share: 2,
    sidebarOpen: true,
    pathCollapsed: false,
    section: 'files'
  })
])('ignores a corrupt or invalid persisted restoration point: %s', (value) => {
  values.set('orca-fork.workbenchFocus.restore.v1', value)
  expect(loadFocusSnapshot()).toBeNull()
})

it('keeps focus usable when storage is blocked', () => {
  vi.stubGlobal('localStorage', {
    getItem: () => {
      throw new Error('blocked')
    },
    removeItem: () => {
      throw new Error('blocked')
    }
  })
  expect(loadFocusSnapshot()).toBeNull()
  expect(() => saveFocusSnapshot(null)).not.toThrow()
})
