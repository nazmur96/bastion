// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from 'vitest'
beforeEach(() => {
  localStorage.clear()
  vi.resetModules()
})
it('starts the desktop with the optional Project path closed and allows it to open', async () => {
  localStorage.setItem('orca-fork.pathColumn.collapsed.v1', 'false')
  const path = await import('./path-column-store')
  path.initializeDesktopPathColumn()
  expect(path.isPathColumnCollapsed()).toBe(true)
  path.togglePathColumn()
  expect(path.isPathColumnCollapsed()).toBe(false)
  path.initializeDesktopPathColumn()
  expect(path.isPathColumnCollapsed()).toBe(false)
})
it('preserves the chosen Project path state on the next renderer start', async () => {
  const first = await import('./path-column-store')
  first.initializeDesktopPathColumn()
  first.togglePathColumn()
  vi.resetModules()
  const restored = await import('./path-column-store')
  restored.initializeDesktopPathColumn()
  expect(restored.isPathColumnCollapsed()).toBe(false)
})
