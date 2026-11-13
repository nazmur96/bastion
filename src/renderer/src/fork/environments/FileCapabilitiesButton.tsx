import { useState } from 'react'
import { useSidebarHostScopeOptions } from '@/components/sidebar/use-sidebar-host-scope-options'
import { indexExecutionHostsById } from '../../../../shared/managed-orcad-execution-host'
import { Puzzle } from 'lucide-react'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { usePluginSyntaxes } from '@/store/plugin-syntax-packs'
import { fileCapabilities } from './file-capabilities'
import { startWorkspaceHost } from '../workbench/start-project-actions'
import { openWorkspacePage } from '../workspace-desktop/workspace-desktop-state'
import { openChanges } from '../changes/change-navigation'

export function FileCapabilitiesButton({
  worktreeId,
  groupId
}: {
  worktreeId: string
  groupId: string
}): React.JSX.Element | null {
  const [open, setOpen] = useState(false)
  const { hostOptions } = useSidebarHostScopeOptions()
  const ownerId = useAppStore(() => startWorkspaceHost(worktreeId))
  const ownerLabel = indexExecutionHostsById(hostOptions).get(ownerId)?.label ?? ownerId
  const group = useAppStore((s) =>
    s.groupsByWorktree[worktreeId]?.find((entry) => entry.id === groupId)
  )
  const tabs = useAppStore((s) => s.unifiedTabsByWorktree[worktreeId])
  const files = useAppStore((s) => s.openFiles)
  const syntaxes = usePluginSyntaxes()
  const tab = tabs?.find(
    (entry) => entry.id === group?.activeTabId && entry.contentType === 'editor'
  )
  const file =
    tab && files?.find((entry) => entry.id === tab.entityId && entry.worktreeId === worktreeId)
  if (!file) {
    return null
  }
  const support = fileCapabilities(file.filePath, syntaxes)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="bx-icon-btn"
          aria-label={translate('workspaceEnvironments.fileSupport', 'File capabilities')}
        >
          <Puzzle aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start">
        <div className="space-y-3 text-xs">
          <h3 className="font-medium">
            {translate('workspaceEnvironments.fileSupport', 'File capabilities')}
          </h3>
          <p className="break-all font-mono">{file.relativePath}</p>
          <dl className="space-y-2">
            <div>
              <dt className="text-muted-foreground">
                {translate('workspaceEnvironments.syntax', 'Syntax highlighting')}
              </dt>
              <dd>
                {support.highlighting === 'built-in'
                  ? `${support.language} · ${translate('workspaceEnvironments.builtIn', 'Built in')}`
                  : (support.syntax?.label ??
                    translate('workspaceEnvironments.plainText', 'Plain text'))}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">
                {translate('workspaceEnvironments.owner', 'Execution owner')}
              </dt>
              <dd className="break-all font-mono">{ownerLabel}</dd>
            </div>
          </dl>
          <p className="text-muted-foreground">
            {translate(
              'workspaceEnvironments.syntaxScope',
              'Syntax support does not install project tools. Language-server connections are not available through Orca syntax packs.'
            )}
          </p>
          <button
            type="button"
            className="workspace-button"
            onClick={() => {
              setOpen(false)
              openChanges('source', [file.relativePath])
            }}
          >
            {translate('changes.open', 'Open project change')}
          </button>
          <button
            type="button"
            className="workspace-button"
            onClick={() => {
              setOpen(false)
              openWorkspacePage('environments')
            }}
          >
            {translate('workspaceEnvironments.runtimeTools', 'View runtime and tool configuration')}
          </button>
          {support.highlighting === 'plain-text' && (
            <button
              type="button"
              className="workspace-button"
              onClick={() => {
                setOpen(false)
                const state = useAppStore.getState()
                state.openSettingsTarget({ pane: 'plugins', repoId: null })
                state.openSettingsPage()
              }}
            >
              {translate('workspaceEnvironments.findSyntax', 'Find a compatible syntax pack')}
            </button>
          )}
        </div>
      </PopoverContent>
      {open && <style>{'[data-retained-group]{visibility:hidden}'}</style>}
    </Popover>
  )
}
