// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => {
  const callbacks: { onChange?: (event: { worktreePath: string; connectionId?: string }) => void } =
    {}
  return { host: 'local', read: vi.fn(), watch: vi.fn(), stop: vi.fn(), callbacks }
})
vi.mock('@/store', () => ({
  useAppStore: (select: (s: unknown) => unknown) =>
    select({ getKnownWorktreeById: () => ({ path: '/repo' }) })
}))
vi.mock('../workbench/start-project-actions', () => ({ startWorkspaceHost: () => m.host }))
vi.mock('../environments/workspace-environment-files', () => ({
  captureProjectFileRoute: () => ({
    context: {
      target: { kind: 'environment', environmentId: m.host },
      worktreeId: 'wt',
      worktreePath: '/repo'
    }
  })
}))
vi.mock('@/runtime/runtime-file-watch-client', () => ({ subscribeRuntimeFileChanges: m.watch }))
vi.mock('./read-project-discovery', () => ({ readProjectDiscovery: m.read }))
import { useProjectDiscovery } from './use-project-discovery'
beforeEach(() => {
  vi.clearAllMocks()
  m.host = 'local'
  m.read.mockResolvedValue({ snapshot: { fingerprint: 'first' } })
  m.watch.mockImplementation((_context, onChange) => {
    m.callbacks.onChange = onChange
    return Promise.resolve(m.stop)
  })
})
afterEach(cleanup)
it('invalidates source changes but keeps the evidence until explicit refresh', async () => {
  const view = renderHook(() => useProjectDiscovery('wt'))
  await waitFor(() => expect(view.result.current.state?.pending).toBe(false))
  act(() => m.callbacks.onChange?.({ worktreePath: '/other' }))
  expect(view.result.current.state?.stale).toBe(false)
  act(() => m.callbacks.onChange?.({ worktreePath: '/repo' }))
  expect(view.result.current.state?.stale).toBe(true)
  expect(view.result.current.state?.data?.snapshot.fingerprint).toBe('first')
  m.read.mockResolvedValue({ snapshot: { fingerprint: 'changed' } })
  act(() => view.result.current.refresh())
  await waitFor(() => expect(view.result.current.state?.data?.snapshot.fingerprint).toBe('changed'))
})
it('does not let a late local inspection populate a remote project with the same path', async () => {
  let finish: ((value: unknown) => void) | undefined
  m.read.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve
      })
  )
  const view = renderHook(() => useProjectDiscovery('switch-test'))
  m.host = 'runtime:new'
  view.rerender()
  await waitFor(() => expect(view.result.current.state?.pending).toBe(false))
  await act(async () => finish?.({ snapshot: { fingerprint: 'old-local' } }))
  expect(view.result.current.state?.data?.snapshot.fingerprint).toBe('first')
})

it('keeps freshness uncertain when the owning file watcher cannot start', async () => {
  m.watch.mockRejectedValueOnce(new Error('Watcher unavailable'))
  const view = renderHook(() => useProjectDiscovery('watch-failure'))
  await waitFor(() => expect(view.result.current.state?.pending).toBe(false))
  expect(view.result.current.state?.stale).toBe(true)
  expect(view.result.current.state?.data?.snapshot.fingerprint).toBe('first')
})
