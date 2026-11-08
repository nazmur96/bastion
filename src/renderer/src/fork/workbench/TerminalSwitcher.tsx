import { ChevronDown, List, Maximize2, Minimize2, Plus, SquareTerminal, X } from 'lucide-react'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { closeTerminalTab } from '@/components/terminal/terminal-tab-actions'
import { newWorkbenchTerminal } from './workbench-terminals'
import { useSideSection } from './side-panel-store'
import { terminalDisplayLabel } from './terminal-display-label'
import { startWorkspaceHost } from './start-project-actions'
import {
  isTerminalDockMaximized,
  liveTerminalDockId,
  toggleMaximizeTerminalDock
} from './terminal-dock'

export function TerminalSwitcher({
  worktreeId,
  groupId
}: {
  worktreeId: string
  groupId: string
}): React.JSX.Element | null {
  const tabs = useAppStore((state) => state.unifiedTabsByWorktree[worktreeId])
  const terminalTabs = useAppStore((state) => state.tabsByWorktree[worktreeId])
  const configuredShell = useAppStore((state) => state.settings?.terminalDefaultShell)
  const local = useAppStore(() => startWorkspaceHost(worktreeId) === 'local')
  const activeTabId = useAppStore(
    (state) =>
      state.groupsByWorktree[worktreeId]?.find((group) => group.id === groupId)?.activeTabId
  )
  const isDock = useAppStore(() => liveTerminalDockId(worktreeId) === groupId)
  const maximized = useAppStore(() => isTerminalDockMaximized(worktreeId))
  const section = useSideSection(worktreeId)
  if (!isDock || section !== 'terminal') {
    return null
  }
  const terminals = (tabs ?? []).filter(
    (tab) => tab.groupId === groupId && tab.contentType === 'terminal'
  )
  const active = terminals.find((tab) => tab.id === activeTabId) ?? terminals[0]
  const label = (tab: (typeof terminals)[number]): string =>
    terminalDisplayLabel(
      tab,
      terminalTabs?.find((terminal) => terminal.id === tab.id),
      local ? configuredShell || window.api.platform.get().shell : ''
    ) || translate('components.sidePanel.terminalName', 'Terminal')
  const newLabel = translate('components.sidePanel.newTerminal', 'New terminal')
  const closeLabel = translate('components.sidePanel.closeTerminal', 'Close terminal')
  const maximizeLabel = maximized
    ? translate('components.sidePanel.restoreTerminal', 'Restore terminal size')
    : translate('components.sidePanel.maximizeTerminal', 'Maximise terminal')
  return (
    <div className="bx-terminal-toolbar" data-terminal-toolbar="">
      <div className="bx-terminal-tabs scrollbar-sleek">
        {terminals.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className="bx-terminal-tab"
            aria-pressed={tab.id === active?.id}
            title={label(tab)}
            onClick={() => useAppStore.getState().activateTab(tab.id, { worktreeId })}
          >
            <SquareTerminal aria-hidden />
            <span>{label(tab)}</span>
          </button>
        ))}
      </div>
      <button
        type="button"
        className="bx-icon-btn"
        title={newLabel}
        aria-label={newLabel}
        onClick={() => newWorkbenchTerminal(worktreeId)}
      >
        <Plus aria-hidden />
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="bx-icon-btn"
            title={translate('components.sidePanel.showTerminalList', 'Show terminal list')}
            aria-label={translate('components.sidePanel.showTerminalList', 'Show terminal list')}
          >
            <List aria-hidden />
            <ChevronDown aria-hidden />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {terminals.map((tab) => (
            <DropdownMenuItem
              key={tab.id}
              onSelect={() => useAppStore.getState().activateTab(tab.id, { worktreeId })}
            >
              <SquareTerminal aria-hidden />
              <span className="min-w-24 flex-1">{label(tab)}</span>
              <button
                type="button"
                className="bx-icon-btn"
                title={closeLabel}
                aria-label={translate('components.sidePanel.closeNamedTerminal', 'Close {{name}}', {
                  name: label(tab)
                })}
                onClick={(event) => {
                  event.stopPropagation()
                  closeTerminalTab(tab.id)
                }}
              >
                <X aria-hidden />
              </button>
            </DropdownMenuItem>
          ))}
          {terminals.length > 0 ? <DropdownMenuSeparator /> : null}
          <DropdownMenuItem onSelect={() => newWorkbenchTerminal(worktreeId)}>
            <Plus aria-hidden />
            {newLabel}
          </DropdownMenuItem>
          {active ? (
            <DropdownMenuItem onSelect={() => closeTerminalTab(active.id)}>
              <X aria-hidden />
              {closeLabel}
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      <button
        type="button"
        className="bx-icon-btn"
        title={maximizeLabel}
        aria-label={maximizeLabel}
        aria-pressed={maximized}
        onClick={() => toggleMaximizeTerminalDock(worktreeId)}
      >
        {maximized ? <Minimize2 aria-hidden /> : <Maximize2 aria-hidden />}
      </button>
    </div>
  )
}
