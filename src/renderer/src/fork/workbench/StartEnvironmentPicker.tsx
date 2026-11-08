import { useState } from 'react'
import { ChevronDown, Laptop, Server } from 'lucide-react'
import { toast } from 'sonner'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import { useSidebarHostScopeOptions } from '@/components/sidebar/use-sidebar-host-scope-options'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import {
  indexExecutionHostsById,
  pickerExecutionHosts
} from '../../../../shared/managed-orcad-execution-host'
import type { ExecutionHostId } from '../../../../shared/execution-host'
import { selectStartEnvironment, startWorkspaceHost } from './start-project-actions'

export function StartEnvironmentPicker({
  workspaceId
}: {
  workspaceId: string
}): React.JSX.Element {
  const { hostOptions } = useSidebarHostScopeOptions()
  const currentHostId = useAppStore(() => startWorkspaceHost(workspaceId))
  const [busy, setBusy] = useState(false)
  const currentHost = indexExecutionHostsById(hostOptions).get(currentHostId)
  const label =
    currentHostId === 'local'
      ? translate('components.start.thisComputer', 'This computer')
      : (currentHost?.label ?? currentHostId)
  const choose = async (hostId: ExecutionHostId): Promise<void> => {
    setBusy(true)
    try {
      await selectStartEnvironment(hostId)
    } catch (error) {
      toast.error(translate('components.start.switchFailed', 'Could not switch environment'), {
        description: error instanceof Error ? error.message : String(error)
      })
    } finally {
      setBusy(false)
    }
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="bx-picker" disabled={busy} aria-busy={busy}>
          {currentHostId === 'local' ? <Laptop aria-hidden /> : <Server aria-hidden />}
          {label}
          <ChevronDown aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <div className="scrollbar-sleek max-h-72 overflow-y-auto">
          {pickerExecutionHosts(hostOptions).map((host) => (
            <DropdownMenuItem
              key={host.id}
              disabled={
                busy ||
                host.id === currentHost?.id ||
                Boolean(host.wslUnavailable) ||
                host.health === 'blocked'
              }
              onSelect={() => void choose(host.id)}
            >
              {host.kind === 'local' ? <Laptop aria-hidden /> : <Server aria-hidden />}
              {host.kind === 'local'
                ? translate('components.start.thisComputer', 'This computer')
                : host.label}
            </DropdownMenuItem>
          ))}
        </div>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={() => {
            const state = useAppStore.getState()
            state.openSettingsTarget({ pane: 'ssh', repoId: null, intent: 'add-ssh-host' })
            state.openSettingsPage()
          }}
        >
          {translate('components.start.remote', 'Remote machine…')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
