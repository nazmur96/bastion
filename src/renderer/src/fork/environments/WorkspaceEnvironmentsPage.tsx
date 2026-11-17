import { DevpodRecipeSetup } from './DevpodRecipeSetup'
import { useEffect, useState } from 'react'
import { Laptop, Server, RefreshCw } from 'lucide-react'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import { useSidebarHostScopeOptions } from '@/components/sidebar/use-sidebar-host-scope-options'
import { pickerExecutionHosts } from '../../../../shared/managed-orcad-execution-host'
import { getExecutionHostHealthLabel } from '@/lib/runtime-host-copy'
import { startWorkspaceHost, selectStartEnvironment } from '../workbench/start-project-actions'
import {
  readWorkspaceEnvironmentFiles,
  type WorkspaceEnvironmentFiles
} from './workspace-environment-files'
import {
  WorkspaceQuickActions,
  showWorkspaceEditor
} from '../workspace-desktop/WorkspaceQuickActions'
import { openWorkspaceFile } from '../devops/open-manifest'
import { toast } from 'sonner'

export function WorkspaceEnvironmentsPage(): React.JSX.Element {
  const id = useAppStore((s) => s.activeWorktreeId)
  const hostId = useAppStore(() => (id ? startWorkspaceHost(id) : null))
  const { hostOptions } = useSidebarHostScopeOptions()
  const [showConfigured, setShowConfigured] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const [result, setResult] = useState<{
    id: string
    hostId: string
    data?: WorkspaceEnvironmentFiles
    error?: string
  } | null>(null)
  const [switching, setSwitching] = useState<string | null>(null)
  useEffect(() => {
    if (!id || !hostId) {
      return
    }
    let live = true
    void readWorkspaceEnvironmentFiles(id)
      .then((data) => {
        if (live) {
          setResult({ id, hostId, data })
        }
      })
      .catch((error: unknown) => {
        if (live) {
          setResult({ id, hostId, error: error instanceof Error ? error.message : String(error) })
        }
      })
    return () => {
      live = false
    }
  }, [id, hostId, refresh])
  const current = result?.id === id && result.hostId === hostId ? result : null
  const conflict =
    current?.data?.files.includes('devenv.nix') &&
    current.data.files.some((file) => file === 'mise.toml' || file === '.mise.toml')
  return (
    <div className="workspace-page scrollbar-sleek" data-workspace-environments="">
      <div className="workspace-eyebrow">
        {translate('workspaceDesktop.environments', 'Environments')}
      </div>
      <header className="workspace-page-heading">
        <div>
          <h1>{translate('workspaceEnvironments.title', 'Choose where your project runs.')}</h1>
          <p>
            {translate(
              'workspaceEnvironments.description',
              'Files, terminals and agents follow the project’s execution host. Cloud deployment targets are configured separately.'
            )}
          </p>
        </div>
        <WorkspaceQuickActions />
      </header>
      <div className="workspace-home-grid">
        <section className="workspace-card">
          <h3>{translate('workspaceEnvironments.hosts', 'Workspace execution hosts')}</h3>
          {pickerExecutionHosts(hostOptions)
            .filter(
              (host) => showConfigured || host.presence !== 'configured' || host.id === hostId
            )
            .map((host) => (
              <div className="workspace-connection" key={host.id}>
                <div className="min-w-0">
                  <strong className="flex items-center gap-2">
                    {host.kind === 'local' ? (
                      <Laptop className="size-4" aria-hidden />
                    ) : (
                      <Server className="size-4" aria-hidden />
                    )}
                    {host.label}
                  </strong>
                  <p>{getExecutionHostHealthLabel(host.health, host.blockedReason)}</p>
                  <small className="break-all text-muted-foreground">{host.detail}</small>
                </div>
                <button
                  type="button"
                  className="workspace-button"
                  disabled={
                    host.id === hostId ||
                    (hostId !== null && host.aliasHostIds?.includes(hostId)) ||
                    switching !== null ||
                    host.health === 'blocked' ||
                    Boolean(host.wslUnavailable)
                  }
                  onClick={() => {
                    setSwitching(host.id)
                    void selectStartEnvironment(host.id)
                      .catch((error: unknown) =>
                        toast.error(error instanceof Error ? error.message : String(error))
                      )
                      .finally(() => setSwitching(null))
                  }}
                >
                  {host.id === hostId || (hostId !== null && host.aliasHostIds?.includes(hostId))
                    ? translate('workspaceEnvironments.selected', 'Selected')
                    : switching === host.id
                      ? translate('workspaceEnvironments.connecting', 'Connecting…')
                      : translate('workspaceEnvironments.openHost', 'Open projects')}
                </button>
              </div>
            ))}
          <button
            type="button"
            className="workspace-button"
            onClick={() => setShowConfigured((value) => !value)}
            aria-expanded={showConfigured}
          >
            {showConfigured
              ? translate('workspaceEnvironments.hideConfigured', 'Hide other configured hosts')
              : translate('workspaceEnvironments.showConfigured', 'Show other configured hosts')}
          </button>
          <p>
            {translate(
              'workspaceEnvironments.hostMeaning',
              'Selecting a host opens projects already attached there, or asks for a folder on that host. It does not move local files into a container.'
            )}
          </p>
          <button
            type="button"
            className="workspace-button"
            onClick={() => {
              const state = useAppStore.getState()
              state.openSettingsTarget({ pane: 'ssh', repoId: null, intent: 'add-ssh-host' })
              state.openSettingsPage()
            }}
          >
            {translate('workspaceEnvironments.addRemote', 'Connect a remote machine')}
          </button>
        </section>
        <section className="workspace-card">
          <div className="workspace-card-title">
            <h3>
              {translate('workspaceEnvironments.config', 'Project environment configuration')}
            </h3>
            <button
              type="button"
              className="bx-icon-btn"
              aria-label={translate(
                'workspaceEnvironments.refresh',
                'Refresh environment configuration'
              )}
              onClick={() => setRefresh((value) => value + 1)}
            >
              <RefreshCw aria-hidden />
            </button>
          </div>
          {!id ? (
            <p>
              {translate(
                'workspaceEnvironments.chooseProject',
                'Select a repository or folder to inspect its environment configuration.'
              )}
            </p>
          ) : !current ? (
            <p role="status">
              {translate(
                'workspaceEnvironments.reading',
                'Reading configuration from the project’s host…'
              )}
            </p>
          ) : current.error ? (
            <p role="alert">{current.error}</p>
          ) : (
            <>
              <p className="break-all font-mono">{current.data?.root}</p>
              {conflict && (
                <p role="alert">
                  {translate(
                    'workspaceEnvironments.conflict',
                    'Both mise and devenv configuration are present. Choose one tool-version owner before setting up tools.'
                  )}
                </p>
              )}
              {current.data?.files.length ? (
                current.data.files.map((file) => (
                  <button
                    type="button"
                    className="workspace-repo font-mono"
                    key={file}
                    onClick={() => {
                      try {
                        current.data?.assertCurrent()
                        showWorkspaceEditor()
                        openWorkspaceFile(id, file, 1)
                      } catch (error) {
                        toast.error(error instanceof Error ? error.message : String(error))
                      }
                    }}
                  >
                    {file}
                  </button>
                ))
              ) : (
                <p>
                  {translate(
                    'workspaceEnvironments.noConfig',
                    'No supported environment configuration was found at this project root.'
                  )}
                </p>
              )}
              <p>
                {translate(
                  'workspaceEnvironments.configScope',
                  'These are declarations, not proof that a container is running. Reading them does not execute setup or install tools.'
                )}
              </p>
            </>
          )}
        </section>
        <section className="workspace-card">
          <h3>{translate('workspaceEnvironments.containerTitle', 'Containers and DevPod')}</h3>
          {id && hostId === 'local' && current?.data && (
            <DevpodRecipeSetup
              worktreeId={id}
              configuration={current.data}
              disabled={Boolean(conflict)}
              onPrepared={() => setRefresh((value) => value + 1)}
            />
          )}

          <p>
            {translate(
              'workspaceEnvironments.containerCopy',
              'Use a committed devcontainer.json for userland and mise.toml or devenv.nix for tool versions. DevPod places the environment; it is not a cloud deployment target.'
            )}
          </p>
          <p>
            {translate(
              'workspaceEnvironments.containerAction',
              'Connect the resulting machine over SSH, or use the repository’s existing Bastion environment recipe when creating a worktree.'
            )}
          </p>
        </section>
        <section className="workspace-card">
          <h3>{translate('workspaceEnvironments.capabilities', 'File-aware capabilities')}</h3>
          <p>
            {translate(
              'workspaceEnvironments.capabilityCopy',
              'Opening a file activates built-in syntax support or a matching installed Bastion syntax pack. Use File capabilities in the editor to inspect support and its execution owner.'
            )}
          </p>
          <p>
            {translate(
              'workspaceEnvironments.noVSCode',
              'VS Code extensions are not directly supported. Runtime tools and language-server connections are separate from syntax packs; no tools are installed on the host automatically.'
            )}
          </p>
          <button
            type="button"
            className="workspace-button"
            onClick={() => {
              const state = useAppStore.getState()
              state.openSettingsTarget({ pane: 'plugins', repoId: null })
              state.openSettingsPage()
            }}
          >
            {translate('workspaceEnvironments.plugins', 'Review compatible plugins')}
          </button>
        </section>
      </div>
    </div>
  )
}
