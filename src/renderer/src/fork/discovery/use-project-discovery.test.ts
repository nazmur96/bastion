// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => {
  const callbacks: {
    onChange?: (event: {
      worktreePath: string
      connectionId?: string
      events: { kind: string; absolutePath: string }[]
    }) => void
  } = {}
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
import { changedProjectPaths, useProjectDiscovery } from './use-project-discovery'
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
  act(() => m.callbacks.onChange?.({ worktreePath: '/other', events: [] }))
  expect(view.result.current.state?.stale).toBe(false)
  act(() => m.callbacks.onChange?.({ worktreePath: '/repo', events: [] }))
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

it('marks only the changed files and ignores Git bookkeeping', async () => {
  const view = renderHook(() => useProjectDiscovery('paths'))
  await waitFor(() => expect(view.result.current.state?.pending).toBe(false))
  act(() =>
    m.callbacks.onChange?.({
      worktreePath: '/repo',
      events: [{ kind: 'update', absolutePath: '/repo/.git/index' }]
    })
  )
  expect(view.result.current.state?.stale).toBe(false)
  act(() =>
    m.callbacks.onChange?.({
      worktreePath: '/repo',
      events: [{ kind: 'update', absolutePath: '/repo/Dockerfile' }]
    })
  )
  expect(view.result.current.state?.stale).toBe(true)
  expect(view.result.current.state?.changedPaths).toEqual(['Dockerfile'])
})

it('does not report a change on focus or after time passes without one', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  try {
    const view = renderHook(() => useProjectDiscovery('quiet'))
    await waitFor(() => expect(view.result.current.state?.pending).toBe(false))
    act(() => {
      window.dispatchEvent(new Event('focus'))
      vi.advanceTimersByTime(120_000)
    })
    expect(view.result.current.state?.stale).toBe(false)
  } finally {
    vi.useRealTimers()
  }
})

it('treats overflow and resync as an unknown change', () => {
  expect(
    changedProjectPaths(
      { worktreePath: '/r', events: [{ kind: 'overflow', absolutePath: '/r' }] },
      '/r'
    )
  ).toBeNull()
  expect(changedProjectPaths({ worktreePath: '/r', events: [], resync: true }, '/r')).toBeNull()
  expect(
    changedProjectPaths(
      {
        worktreePath: '/r',
        events: [{ kind: 'rename', absolutePath: '/r/b.yaml', oldAbsolutePath: '/r/a.yaml' }]
      },
      '/r/'
    )
  ).toEqual(['b.yaml', 'a.yaml'])
})
