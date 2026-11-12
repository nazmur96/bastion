import { WorkspaceEnvironmentsPage } from '../environments/WorkspaceEnvironmentsPage'
import { FileSearch } from 'lucide-react'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import { setInfraView } from '../devops/infra-home-store'
import { WorkspaceDiscoveryPage } from '../discovery/WorkspaceDiscoveryPage'
import { WorkspaceHomePage } from './WorkspaceHomePage'
import { workspaceNavigation } from './workspace-navigation'
import { useWorkspacePage } from './workspace-desktop-state'
import { addWorkspaceProject, showWorkspaceEditor } from './WorkspaceQuickActions'

function openInfrastructure(): void {
  const id = useAppStore.getState().activeWorktreeId
  if (!id) {
    return addWorkspaceProject()
  }
  showWorkspaceEditor()
  setInfraView(id, 'tools')
}
function openConnectionSettings(): void {
  const state = useAppStore.getState()
  state.openSettingsTarget({ pane: 'infrastructure', repoId: null })
  state.openSettingsPage()
}
export function WorkspacePages(): React.JSX.Element | null {
  const page = useWorkspacePage()
  const id = useAppStore((s) => s.activeWorktreeId)
  if (page === 'editor' || page === 'source') {
    return id ? null : <ProjectRequired />
  }
  if (page === 'environments') {
    return <WorkspaceEnvironmentsPage />
  }
  if (page === 'home') {
    return <WorkspaceHomePage />
  }
  if (page === 'discovery') {
    return id ? <WorkspaceDiscoveryPage key={id} worktreeId={id} /> : <ProjectRequired />
  }
  const title = workspaceNavigation().find((item) => item.id === page)?.label
  return (
    <div className="workspace-page scrollbar-sleek">
      <div className="workspace-eyebrow">
        {translate('workspaceDesktop.environmentGroup', 'Environments & delivery')}
      </div>
      <header className="workspace-page-heading">
        <div>
          <h1>{title}</h1>
          <p>
            {translate(
              'workspaceDesktop.infrastructureCopy',
              'Keep infrastructure tools and connections alongside the code they belong to.'
            )}
          </p>
        </div>
      </header>
      <div className="workspace-home-grid">
        <section className="workspace-card">
          <h2>{translate('workspaceDesktop.connectTools', 'Connect your existing tools.')}</h2>
          <p>
            {translate(
              'workspaceDesktop.capabilityDescription',
              'Open the existing infrastructure tools for detected stack commands, cloud configuration and deployment controls. Operations run only when you explicitly start them.'
            )}
          </p>
          <div className="workspace-card-actions">
            <button
              type="button"
              className="workspace-button workspace-button-primary"
              onClick={openInfrastructure}
            >
              {translate('workspaceDesktop.infrastructureTools', 'Open infrastructure tools')}
            </button>
            <button type="button" className="workspace-button" onClick={openConnectionSettings}>
              {translate('workspaceDesktop.connectionSettings', 'Connection settings')}
            </button>
          </div>
        </section>
        <section className="workspace-card">
          <div className="workspace-eyebrow">
            {translate('workspaceDesktop.currentScope', 'Available today')}
          </div>
          <h3>{translate('workspaceDesktop.realTools', 'Real tools. Explicit actions.')}</h3>
          <p>
            {translate(
              'workspaceDesktop.capabilityScope',
              'This view uses the existing Orca integrations. The prototype’s connected cloud inventory, shared delivery records and verification timeline are still being built.'
            )}
          </p>
          <button type="button" className="workspace-button" onClick={showWorkspaceEditor}>
            {translate('workspaceDesktop.backWorkbench', 'Back to workbench')}
          </button>
        </section>
      </div>
    </div>
  )
}
function ProjectRequired(): React.JSX.Element {
  return (
    <div className="workspace-page">
      <section className="workspace-card workspace-empty">
        <FileSearch className="size-6" aria-hidden />
        <h2>{translate('workspaceDesktop.chooseProject', 'Choose a project to begin.')}</h2>
        <p>
          {translate(
            'workspaceDesktop.chooseProjectCopy',
            'Select an attached repository in the sidebar, or add one to this workspace.'
          )}
        </p>
        <button type="button" className="workspace-button" onClick={addWorkspaceProject}>
          {translate('workspaceDesktop.addProject', 'Add project')}
        </button>
      </section>
    </div>
  )
}
