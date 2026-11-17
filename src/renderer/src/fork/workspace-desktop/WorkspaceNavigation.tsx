import { CalendarClock, CheckCheck, LogOut, Plug, Settings, Smartphone } from 'lucide-react'
import { toast } from 'sonner'
import { useState } from 'react'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import { ProjectWorkspacePicker } from '../project-workspaces/ProjectWorkspacePicker'
import { useProjectWorkspaces } from '../project-workspaces/use-project-workspaces'
import { PROJECT_WORKSPACE_HOME_ID } from '../../../../shared/fork-project-workspaces'
import { workspaceErrorMessage } from '../project-workspaces/workspace-error-message'
import { openWorkspacePage, useWorkspacePage } from './workspace-desktop-state'
import { workspaceNavigation } from './workspace-navigation'

export function WorkspaceNavigation(): React.JSX.Element {
  const page = useWorkspacePage()
  const view = useAppStore((s) => s.activeView)
  const repos = useAppStore((s) => s.repos)
  const { snapshot } = useProjectWorkspaces()
  const name = snapshot?.workspaces.find((entry) => entry.id === snapshot.activeId)?.name
  return (
    <div className="workspace-navigation">
      <div className="workspace-identity">
        <span className="workspace-avatar" aria-hidden>
          W
        </span>
        <div className="min-w-0">
          <ProjectWorkspacePicker />
          <p>
            {translate('workspaceDesktop.desktop', 'Project desktop')} · {repos.length}{' '}
            {repos.length === 1
              ? translate('workspaceDesktop.repository', 'repository')
              : translate('workspaceDesktop.repositories', 'repositories')}
          </p>
        </div>
      </div>
      <nav
        className="workspace-navigation-scroll scrollbar-sleek"
        aria-label={translate('workspaceDesktop.navigation', 'Workspace navigation')}
      >
        {[0, 1].map((group) => (
          <section key={group}>
            <div className="workspace-eyebrow">
              {group === 0
                ? translate('workspaceDesktop.yourDesktop', 'Your project desktop')
                : translate('workspaceDesktop.environmentGroup', 'Environments & delivery')}
            </div>
            {workspaceNavigation()
              .filter((item) => item.group === group)
              .map(({ id, label, icon: Icon }) => (
                <button
                  type="button"
                  key={id}
                  className="workspace-nav-item"
                  aria-current={
                    (id === 'agents' ? view === 'activity' : page === id && view === 'terminal')
                      ? 'page'
                      : undefined
                  }
                  onClick={() =>
                    // Orca's Agents view already covers chats and agents running in terminals.
                    id === 'agents'
                      ? useAppStore.getState().openActivityPage()
                      : openWorkspacePage(id)
                  }
                >
                  <Icon aria-hidden className="size-4" />
                  <span>{label}</span>
                </button>
              ))}
          </section>
        ))}
        <section>
          <div className="workspace-eyebrow">
            {translate('workspaceDesktop.tools', 'Workspace tools')}
          </div>
          <button
            type="button"
            className="workspace-nav-item"
            aria-current={view === 'tasks' ? 'page' : undefined}
            onClick={() => useAppStore.getState().openTaskPage()}
          >
            <CheckCheck className="size-4" aria-hidden />
            {translate('workspaceDesktop.tasks', 'Tasks & labels')}
          </button>
          <button
            type="button"
            className="workspace-nav-item"
            aria-current={view === 'automations' ? 'page' : undefined}
            onClick={() => useAppStore.getState().openAutomationsPage()}
          >
            <CalendarClock className="size-4" aria-hidden />
            {translate('workspaceDesktop.automations', 'Automations')}
          </button>
          <button
            type="button"
            className="workspace-nav-item"
            onClick={() => {
              const s = useAppStore.getState()
              s.openSettingsTarget({ pane: 'plugins', repoId: null })
              s.openSettingsPage()
            }}
          >
            <Plug className="size-4" aria-hidden />
            {translate('workspaceDesktop.plugins', 'Plugins & capabilities')}
          </button>
          <button
            type="button"
            className="workspace-nav-item"
            aria-current={view === 'mobile' ? 'page' : undefined}
            onClick={() => useAppStore.getState().openMobilePage()}
          >
            <Smartphone className="size-4" aria-hidden />
            {translate('workspaceDesktop.mobile', 'Bastion Mobile')}
          </button>
          <button
            type="button"
            className="workspace-nav-item"
            aria-current={view === 'settings' ? 'page' : undefined}
            onClick={() => useAppStore.getState().openSettingsPage()}
          >
            <Settings className="size-4" aria-hidden />
            {translate('workspaceDesktop.settings', 'Settings')}
          </button>
        </section>
      </nav>
      <span className="sr-only">{name}</span>
    </div>
  )
}

export function WorkspaceLeaveButton(): React.JSX.Element {
  const { snapshot } = useProjectWorkspaces()
  const [busy, setBusy] = useState(false)
  return (
    <button
      type="button"
      className="workspace-leave"
      disabled={busy || !snapshot}
      onClick={() => {
        if (!snapshot || busy || !window.api.projectWorkspaces) {
          return
        }
        setBusy(true)
        void window.api.projectWorkspaces
          .switch({ fromId: snapshot.activeId, toId: PROJECT_WORKSPACE_HOME_ID })
          .catch((error: unknown) => {
            setBusy(false)
            toast.error(workspaceErrorMessage(error))
          })
      }}
    >
      <LogOut className="size-4" aria-hidden />
      {busy
        ? translate('workspaceDesktop.leaving', 'Leaving workspace…')
        : translate('components.projectWorkspaces.leave', 'Leave workspace')}
    </button>
  )
}
