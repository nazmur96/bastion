import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({
  activeWorktreeId: 'a',
  sidebarOpen: true,
  pathCollapsed: false,
  dockIds: new Map([
    ['a', 'dock-a'],
    ['b', 'dock-b']
  ]),
  shares: new Map([
    ['a', 0.73],
    ['b', 0.42]
  ]),
  sections: new Map<string, string>()
}))

vi.mock('@/store', () => ({
  useAppStore: {
    getState: () => ({
      activeWorktreeId: fixture.activeWorktreeId,
      sidebarOpen: fixture.sidebarOpen,
      setSidebarOpen: (open: boolean) => {
        fixture.sidebarOpen = open
      }
    })
  }
}))
vi.mock('../devops/path-column-store', () => ({
  isPathColumnCollapsed: () => fixture.pathCollapsed,
  setPathColumnCollapsed: (collapsed: boolean) => {
    fixture.pathCollapsed = collapsed
  }
}))
vi.mock('./side-panel-store', () => ({
  readSideSection: (id: string) => fixture.sections.get(id) ?? 'files',
  setSideSection: (id: string, section: string) => fixture.sections.set(id, section)
}))
vi.mock('./terminal-dock', () => ({
  liveTerminalDockId: (id: string) => fixture.dockIds.get(id) ?? null,
  readTerminalDockSplit: (id: string) =>
    fixture.shares.has(id) ? { path: '', workbenchShare: fixture.shares.get(id) } : null,
  setTerminalDockShare: (id: string, share: number) => fixture.shares.set(id, share)
}))

import {
  focusWorkbenchSurface,
  readWorkbenchFocus,
  restoreWorkbenchLayout,
  toggleWorkbenchFocus
} from './workbench-focus'

beforeEach(() => {
  fixture.activeWorktreeId = 'a'
  fixture.sidebarOpen = true
  fixture.pathCollapsed = false
  fixture.shares.set('a', 0.73)
  fixture.shares.set('b', 0.42)
  fixture.dockIds.set('a', 'dock-a')
  fixture.sections.clear()
})
afterEach(() => {
  restoreWorkbenchLayout('a')
  restoreWorkbenchLayout('b')
})

describe('workbench focus restoration', () => {
  it('restores the custom width, both sidebars and the prior panel section', () => {
    fixture.sections.set('a', 'checks')
    toggleWorkbenchFocus('a', 'terminal')
    expect(fixture.shares.get('a')).toBe(0)
    expect(fixture.sidebarOpen).toBe(false)
    expect(fixture.pathCollapsed).toBe(true)
    expect(fixture.sections.get('a')).toBe('terminal')
    toggleWorkbenchFocus('a', 'terminal')
    expect(fixture.shares.get('a')).toBe(0.73)
    expect(fixture.sidebarOpen).toBe(true)
    expect(fixture.pathCollapsed).toBe(false)
    expect(fixture.sections.get('a')).toBe('checks')
    expect(readWorkbenchFocus('a')).toBeNull()
  })

  it('switches from terminal to editor focus without replacing the original snapshot', () => {
    focusWorkbenchSurface('a', 'terminal')
    focusWorkbenchSurface('a', 'workbench')
    expect(fixture.shares.get('a')).toBe(1)
    expect(readWorkbenchFocus('a')).toBe('workbench')
    restoreWorkbenchLayout('a')
    expect(fixture.shares.get('a')).toBe(0.73)
    expect(fixture.sidebarOpen).toBe(true)
  })

  it('preserves an already minimal layout when leaving focus', () => {
    fixture.sidebarOpen = false
    fixture.pathCollapsed = true
    fixture.shares.set('a', 1)
    focusWorkbenchSurface('a', 'terminal')
    restoreWorkbenchLayout('a')
    expect(fixture.sidebarOpen).toBe(false)
    expect(fixture.pathCollapsed).toBe(true)
    expect(fixture.shares.get('a')).toBe(1)
  })

  it('rejects an inactive workspace action without changing visible chrome', () => {
    focusWorkbenchSurface('b', 'terminal')
    expect(fixture.shares.get('b')).toBe(0.42)
    expect(fixture.sidebarOpen).toBe(true)
    expect(readWorkbenchFocus('b')).toBeNull()
  })

  it('keeps restoration scoped when another workspace becomes active', () => {
    focusWorkbenchSurface('a', 'terminal')
    fixture.activeWorktreeId = 'b'
    focusWorkbenchSurface('b', 'workbench')
    expect(fixture.shares.get('a')).toBe(0.73)
    expect(fixture.shares.get('b')).toBe(1)
    expect(readWorkbenchFocus('a')).toBeNull()
    restoreWorkbenchLayout('a')
    expect(readWorkbenchFocus('b')).toBe('workbench')
    restoreWorkbenchLayout('b')
    expect(fixture.shares.get('b')).toBe(0.42)
    expect(fixture.sidebarOpen).toBe(true)
  })

  it('does not apply an old split ratio to a replacement dock', () => {
    focusWorkbenchSurface('a', 'terminal')
    fixture.dockIds.set('a', 'replacement')
    fixture.shares.set('a', 0.55)
    restoreWorkbenchLayout('a')
    expect(fixture.shares.get('a')).toBe(0.55)
    expect(fixture.sidebarOpen).toBe(true)
  })
})
