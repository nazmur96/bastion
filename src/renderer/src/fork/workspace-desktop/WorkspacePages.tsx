import { startWorkspaceHost } from '../workbench/start-project-actions'
import { WorkspaceEnvironmentsPage } from '../environments/WorkspaceEnvironmentsPage'
import { FileSearch } from 'lucide-react'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import { setInfraView } from '../devops/infra-home-store'
import { useDevopsInspection } from '../devops/use-devops-inspection'
import { WorkspaceHomePage } from './WorkspaceHomePage'
import { workspaceNavigation } from './workspace-navigation'
import { useWorkspacePage } from './workspace-desktop-state'
import {
  addWorkspaceProject,
  showWorkspaceEditor,
  WorkspaceQuickActions
} from './WorkspaceQuickActions'

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
    return id ? <WorkspaceDiscovery key={id} worktreeId={id} /> : <ProjectRequired />
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
function WorkspaceDiscovery({ worktreeId }: { worktreeId: string }): React.JSX.Element {
  const inspection = useDevopsInspection(worktreeId)
  const host = useAppStore(() => startWorkspaceHost(worktreeId))
  return (
    <div className="workspace-page scrollbar-sleek">
      {host !== 'local' && (
        <p role="status">
          {translate(
            'workspaceEnvironments.remoteInspection',
            'Infrastructure tool inspection is not available on this runtime. Environment configuration can still be read from its owner.'
          )}
        </p>
      )}
      <div className="workspace-eyebrow">
        {translate('workspaceDesktop.discovery', 'Project discovery')}
      </div>
      <header className="workspace-page-heading">
        <div>
          <h1>
            {translate('workspaceDesktop.projectNeeds', 'Understand what this project needs.')}
          </h1>
          <p>
            {translate(
              'workspaceDesktop.discoveryCopy',
              'Detected stacks and their source folders. Review the source before choosing infrastructure or running commands.'
            )}
          </p>
        </div>
        <WorkspaceQuickActions />
      </header>
      <div className="workspace-home-grid">
        {inspection?.findings.map((finding) => (
          <section className="workspace-card" key={finding.stack}>
            <h3>{finding.stack}</h3>
            {finding.dirs.map((dir) => (
              <p className="font-mono break-all" key={dir}>
                {dir || '.'}
              </p>
            ))}
          </section>
        ))}
      </div>
      {host === 'local' && (!inspection || inspection.findings.length === 0) ? (
        <section className="workspace-card">
          <p>
            {inspection
              ? translate(
                  'workspaceDesktop.noStacks',
                  'No supported infrastructure stacks detected in the selected project.'
                )
              : translate('workspaceDesktop.inspecting', 'Reading project requirements…')}
          </p>
        </section>
      ) : null}
      <section className="workspace-card mt-5">
        <h3>{translate('workspaceDesktop.nextDecision', 'Choose your next step')}</h3>
        <p>
          {translate(
            'workspaceDesktop.discoveryNext',
            'Inspect the files, ask your chosen agent, or open the infrastructure toolbelt. Discovery does not create resources.'
          )}
        </p>
        <div className="workspace-card-actions">
          <button type="button" className="workspace-button" onClick={showWorkspaceEditor}>
            {translate('workspaceDesktop.openEditor', 'Open editor')}
          </button>
          <button type="button" className="workspace-button" onClick={openInfrastructure}>
            {translate('workspaceDesktop.infrastructureTools', 'Open infrastructure tools')}
          </button>
        </div>
      </section>
    </div>
  )
}
