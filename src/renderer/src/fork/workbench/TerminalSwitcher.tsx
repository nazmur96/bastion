import { ChevronDown, Plus, SquareTerminal, X } from 'lucide-react'
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

/** Cursor's terminal header: the open terminal's name with a list of all of them, and +. */
export function TerminalSwitcher({
  worktreeId,
  groupId
}: {
  worktreeId: string
  groupId: string
}): React.JSX.Element {
  // Select the stable lists, filter after: a filtered selector result is new on every read.
  const tabs = useAppStore((state) => state.unifiedTabsByWorktree[worktreeId])
  const activeTabId = useAppStore(
    (state) =>
      state.groupsByWorktree[worktreeId]?.find((group) => group.id === groupId)?.activeTabId
  )
  const terminals = (tabs ?? []).filter(
    (tab) => tab.groupId === groupId && tab.contentType === 'terminal'
  )
  const active = terminals.find((tab) => tab.id === activeTabId) ?? terminals[0]
  const label = (tab: (typeof terminals)[number]): string =>
    tab.customLabel || tab.label || translate('components.sidePanel.terminalName', 'Terminal')
  return (
    <div className="bx-term-switch">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className="bx-picker">
            <SquareTerminal aria-hidden />
            {active ? label(active) : translate('components.sidePanel.noTerminal', 'No terminal')}
            {terminals.length > 1 ? <span className="bx-count">{terminals.length}</span> : null}
            <ChevronDown aria-hidden />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {terminals.map((tab) => (
            <DropdownMenuItem
              key={tab.id}
              onSelect={() => useAppStore.getState().activateTab(tab.id, { worktreeId })}
            >
              <SquareTerminal aria-hidden />
              {label(tab)}
            </DropdownMenuItem>
          ))}
          {terminals.length > 0 ? <DropdownMenuSeparator /> : null}
          <DropdownMenuItem onSelect={() => newWorkbenchTerminal(worktreeId)}>
            <Plus aria-hidden />
            {translate('components.sidePanel.newTerminal', 'New terminal')}
          </DropdownMenuItem>
          {active ? (
            <DropdownMenuItem onSelect={() => closeTerminalTab(active.id)}>
              <X aria-hidden />
              {translate('components.sidePanel.closeTerminal', 'Close terminal')}
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
      <button
        type="button"
        className="bx-icon-btn"
        aria-label={translate('components.sidePanel.newTerminal', 'New terminal')}
        title={translate('components.sidePanel.newTerminal', 'New terminal')}
        onClick={() => newWorkbenchTerminal(worktreeId)}
      >
        <Plus aria-hidden />
      </button>
    </div>
  )
}
