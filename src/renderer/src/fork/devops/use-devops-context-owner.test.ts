// @vitest-environment happy-dom
import { renderHook, waitFor, cleanup } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  state: { host: 'local', path: '/same/path' },
  context: vi.fn(),
  inspect: vi.fn()
}))
vi.mock('@/store', () => ({
  useAppStore: (selector: (s: typeof mocks.state) => unknown) => selector(mocks.state)
}))
vi.mock('@/store/selectors', () => ({
  selectKnownWorktreeById: () => ({ path: mocks.state.path })
}))
vi.mock('@/lib/worktree-runtime-owner', () => ({
  getKnownExecutionHostIdForWorktree: () => mocks.state.host
}))
import { useDevopsContext } from './use-devops-context'
import { useDevopsInspection } from './use-devops-inspection'
beforeEach(() => {
  vi.clearAllMocks()
  mocks.state.host = 'ssh:fixture'
  mocks.context.mockResolvedValue({ aws: { profile: 'local-only' } })
  mocks.inspect.mockResolvedValue({ findings: [], environment: 'path', shell: 'posix', tools: {} })
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: { aiVault: { readDevopsContext: mocks.context, inspectDevops: mocks.inspect } }
  })
})
afterEach(cleanup)
it('does not probe desktop tools or cloud configuration for remote projects with colliding paths', () => {
  const context = renderHook(() => useDevopsContext('remote', null, ''))
  const tools = renderHook(() => useDevopsInspection('remote'))
  expect(context.result.current).toEqual({})
  expect(tools.result.current).toBeNull()
  expect(mocks.context).not.toHaveBeenCalled()
  expect(mocks.inspect).not.toHaveBeenCalled()
})
it('drops local context immediately when the same path changes to remote ownership', async () => {
  mocks.state.host = 'local'
  const view = renderHook(() => useDevopsContext('project', null, ''))
  await waitFor(() => expect(view.result.current.aws?.profile).toBe('local-only'))
  mocks.state.host = 'runtime:container'
  view.rerender()
  expect(view.result.current).toEqual({})
})
