import { workspaceErrorMessage } from './workspace-error-message'
import { useState } from 'react'
import { toast } from 'sonner'
import { ChevronDown, Layers, LogOut } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { translate } from '@/i18n/i18n'
import {
  PROJECT_WORKSPACE_HOME_ID,
  isListedWorkspace
} from '../../../../shared/fork-project-workspaces'
import { useProjectWorkspaces } from './use-project-workspaces'

const NO_DRAG: React.CSSProperties & { WebkitAppRegion: 'no-drag' } = { WebkitAppRegion: 'no-drag' }

/** Names the owning workspace; creation lives on application home, so this only leaves or switches. */
export function ProjectWorkspacePicker(): React.JSX.Element | null {
  const api = window.api.projectWorkspaces
  const { snapshot } = useProjectWorkspaces()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  if (!api || !snapshot || snapshot.activeId === PROJECT_WORKSPACE_HOME_ID) {
    return null
  }
  const active =
    snapshot.activeTask?.workspace ??
    snapshot.workspaces.find((workspace) => workspace.id === snapshot.activeId)
  const others = snapshot.workspaces.filter(
    (workspace) => workspace.id !== snapshot.activeId && isListedWorkspace(workspace)
  )

  function go(toId: string): void {
    if (busy || !api || !snapshot) {
      return
    }
    setBusy(true)
    api.switch({ fromId: snapshot.activeId, toId }).catch((cause: unknown) => {
      setBusy(false)
      toast.error(workspaceErrorMessage(cause))
    })
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          className="titlebar-icon-button !w-auto gap-2 px-2"
          style={NO_DRAG}
          aria-label={translate('components.projectWorkspaces.menu', 'Project workspace {{name}}', {
            name: active?.name ?? ''
          })}
          disabled={busy}
        >
          <Layers size={14} />
          <span className="max-w-32 truncate text-xs">{active?.name}</span>
          <ChevronDown size={12} />
        </button>
      </DropdownMenuTrigger>
      {/* Retained terminal and browser surfaces paint above portals; hide them while the menu is open. */}
      {open && <style>{'[data-retained-group]{visibility:hidden}'}</style>}
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuItem disabled={busy} onSelect={() => go(PROJECT_WORKSPACE_HOME_ID)}>
          <LogOut className="size-4" />
          {snapshot.activeTask
            ? translate('components.incognito.close', 'Archive and leave')
            : translate('components.projectWorkspaces.leave', 'Leave workspace')}
        </DropdownMenuItem>
        {others.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>
              {translate('components.projectWorkspaces.switchTo', 'Switch to')}
            </DropdownMenuLabel>
            {others.map((workspace) => (
              <DropdownMenuItem
                key={workspace.id}
                disabled={busy}
                onSelect={() => go(workspace.id)}
              >
                <span className="truncate">{workspace.name}</span>
              </DropdownMenuItem>
            ))}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
