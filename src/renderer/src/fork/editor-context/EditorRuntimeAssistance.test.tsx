// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => {
  const changedPaths: string[] = []
  const commands: { run: () => void }[] = []
  return {
    version: 1,
    target: 'one',
    host: 'local',
    connected: true,
    refresh: vi.fn(),
    changedPaths,
    commands,
    copy: vi.fn(),
    entry: {
      ownerId: 'editor',
      file: 'main.tf',
      modelVersion: 1,
      language: 'hcl',
      cursorLine: 1,
      selection: null,
      readMarkers: () => [
        { severity: 8, startLineNumber: 1, message: 'DO_NOT_COPY_DIAGNOSTIC_SECRET' }
      ]
    }
  }
})
vi.mock('@/store', () => ({
  useAppStore: Object.assign(
    (select: (s: unknown) => unknown) =>
      select({
        activeWorktreeId: 'fixture',
        unifiedTabsByWorktree: { fixture: [] },
        runtimeStatusByEnvironmentId: new Map()
      }),
    { getState: () => ({ activeWorktreeId: 'fixture' }) }
  )
}))
vi.mock('../workbench/start-project-actions', () => ({ startWorkspaceHost: () => m.host }))
vi.mock('./editor-context-store', () => ({
  useEditorContextEntry: () => m.entry,
  readEditorContextEntry: () => m.entry
}))
vi.mock('../devops/use-devops-context', () => ({
  useDevopsContext: () => ({ kube: { context: m.target } })
}))
vi.mock('@/components/sidebar/use-sidebar-host-scope-options', () => ({
  useSidebarHostScopeOptions: () => ({
    hostOptions: [{ id: m.host, health: m.connected ? 'available' : 'disconnected' }]
  })
}))
vi.mock('../discovery/use-project-discovery', () => ({
  useProjectDiscovery: () => ({
    refresh: m.refresh,
    state: {
      pending: false,
      watchFailed: false,
      changedPaths: m.changedPaths,
      data: {
        inspection: { tools: { terraform: { available: false } } },
        snapshot: {
          hostId: m.host,
          root: '/fixture',
          fingerprint: 'one',
          facts: [],
          findings: [],
          limits: ['bounded']
        }
      }
    }
  })
}))
vi.mock('../devops/command-deck-store', () => ({
  useDeckCommands: (_key: string, commands: { run: () => void }[]) => {
    m.commands = commands
  }
}))
vi.mock('../environments/workspace-environment-files', () => ({
  captureProjectFileRoute: () => ({ guard: { assertCurrent: () => {} } })
}))
vi.mock('@/runtime/structured-agent-session-owner', () => ({
  structuredAgentSessionOwnerForTab: () => m.host
}))
vi.mock('./assistance-chat-draft', () => ({ draftAssistanceInOpenChat: vi.fn() }))
import { EditorRuntimeAssistance } from './EditorRuntimeAssistance'
beforeEach(() => {
  m.version++
  m.entry.modelVersion = m.version
  m.target = 'one'
  m.host = 'local'
  m.connected = true
  m.refresh.mockClear()
  m.changedPaths = []
  m.copy.mockReset()
  // The renderer Clipboard API is permission-denied in Orca; drafts copy through the app bridge.
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: { ui: { writeClipboardText: m.copy.mockResolvedValue(undefined) } }
  })
})
afterEach(cleanup)
const element = () => (
  <EditorRuntimeAssistance worktreeId="fixture" relativePath="main.tf" enabled />
)
function prepare(): void {
  fireEvent.click(screen.getByRole('button', { name: 'Review file context' }))
  fireEvent.click(screen.getByRole('button', { name: 'Prepare an unsent draft' }))
}
it('refuses copying a prepared draft after a file edit, target change or source notification', () => {
  const view = render(element())
  prepare()
  expect(
    screen.getByRole('textbox', { name: 'Unsent assistance draft' }).getAttribute('readonly')
  ).not.toBeNull()
  m.entry.modelVersion++
  view.rerender(element())
  expect(screen.getByRole('button', { name: 'Copy reviewed draft' }).hasAttribute('disabled')).toBe(
    true
  )
  fireEvent.click(screen.getByRole('button', { name: 'Copy reviewed draft' }))
  expect(m.copy).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Prepare an unsent draft' }))
  m.target = 'two'
  view.rerender(element())
  expect(screen.getByRole('button', { name: 'Copy reviewed draft' }).hasAttribute('disabled')).toBe(
    true
  )
  fireEvent.click(screen.getByRole('button', { name: 'Prepare an unsent draft' }))
  m.changedPaths = ['main.tf']
  view.rerender(element())
  expect(
    screen.getByRole('button', { name: 'Prepare an unsent draft' }).hasAttribute('disabled')
  ).toBe(true)
})
it('copies only the bounded reviewed draft and omits marker messages', () => {
  render(element())
  prepare()
  fireEvent.click(screen.getByRole('button', { name: 'Copy reviewed draft' }))
  expect(m.copy).toHaveBeenCalledTimes(1)
  expect(m.copy.mock.calls[0][0]).not.toContain('DO_NOT_COPY_DIAGNOSTIC_SECRET')
})
it('keeps a dismissal across file edits and restores explicit help through the existing command', () => {
  const view = render(element())
  fireEvent.click(screen.getByRole('button', { name: 'Dismiss assistance for this file' }))
  m.entry.modelVersion++
  m.changedPaths = ['main.tf']
  view.rerender(element())
  expect(screen.queryByRole('button', { name: 'Review file context' })).toBeNull()
  act(() => m.commands[0].run())
  expect(screen.getByRole('button', { name: 'Prepare an unsent draft' })).toBeTruthy()
})

it('visibly disables a remote draft on disconnect and refreshes owner context', () => {
  m.host = 'runtime:fixture'
  const view = render(element())
  prepare()
  m.connected = false
  view.rerender(element())
  expect(screen.getByRole('button', { name: 'Copy reviewed draft' }).hasAttribute('disabled')).toBe(
    true
  )
  expect(m.refresh).toHaveBeenCalledTimes(1)
})

it('re-reads stale project context when help is opened after a save', () => {
  m.changedPaths = ['main.tf']
  render(element())
  fireEvent.click(screen.getByRole('button', { name: 'Review file context' }))
  expect(m.refresh).toHaveBeenCalledTimes(1)
  fireEvent.click(screen.getByRole('button', { name: 'Refresh project context' }))
  expect(m.refresh).toHaveBeenCalledTimes(2)
})
