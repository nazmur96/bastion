import { getFolderWorkspaceHostId } from '../../../../shared/folder-workspace-execution-host'
import { ArrowRight, FolderGit2, GitBranch } from 'lucide-react'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import { activateAndRevealWorkspace } from '@/lib/worktree-activation'
import { getRepoExecutionHostId } from '../../../../shared/execution-host'
import { folderWorkspaceKey } from '../../../../shared/workspace-scope'
import { useProjectWorkspaces } from '../project-workspaces/use-project-workspaces'
import { openWorkspacePage } from './workspace-desktop-state'
import {
  addWorkspaceProject,
  showWorkspaceEditor,
  WorkspaceQuickActions
} from './WorkspaceQuickActions'

export function WorkspaceHomePage(): React.JSX.Element {
  const { snapshot } = useProjectWorkspaces()
  const repos = useAppStore((s) => s.repos)
  const byRepo = useAppStore((s) => s.worktreesByRepo)
  const folders = useAppStore((s) => s.folderWorkspaces)
  const projectGroups = useAppStore((s) => s.projectGroups)
  const tabs = useAppStore((s) => s.unifiedTabsByWorktree)
  const name = snapshot?.workspaces.find((entry) => entry.id === snapshot.activeId)?.name ?? ''
  const allTabs = Object.values(tabs).flat()
  const terminalCount = allTabs.filter((tab) => tab.contentType === 'terminal').length
  // Chats are tabs; agents started in a terminal are tracked by their pane's live status.
  const terminalAgents = useAppStore((s) => Object.keys(s.agentStatusByPaneKey).length)
  const agentCount =
    allTabs.filter((tab) => tab.contentType === 'agent-session').length + terminalAgents
  return (
    <div className="workspace-page scrollbar-sleek" data-workspace-home="">
      <div className="workspace-eyebrow">
        {translate('workspaceDesktop.pickup', 'Workspace / Pick up your work')}
      </div>
      <header className="workspace-page-heading">
        <div>
          <h1>{name}</h1>
          <p>
            {translate(
              'workspaceDesktop.sharedContext',
              'Your code, agents and infrastructure share one project context. Start directly, or understand what this application needs.'
            )}
          </p>
        </div>
        <button type="button" className="workspace-button" onClick={addWorkspaceProject}>
          {translate('workspaceDesktop.addProject', 'Add project')}
        </button>
      </header>
      <div className="workspace-summary-strip">
        <strong>{name}</strong>
        <span>
          {repos.length} {translate('workspaceDesktop.repositories', 'repositories')}
        </span>
        <span>
          {agentCount} {translate('workspaceDesktop.agentSessions', 'agent sessions')}
        </span>
        <span>
          {terminalCount} {translate('workspaceDesktop.terminals', 'terminals')}
        </span>
      </div>
      <div className="workspace-home-grid">
        <section className="workspace-card workspace-start-card">
          <div className="workspace-eyebrow">
            {translate('workspaceDesktop.startApplication', 'Start with the application')}
          </div>
          <h2>{translate('workspaceDesktop.understand', 'Understand what you inherited.')}</h2>
          <p>
            {translate(
              'workspaceDesktop.understandCopy',
              'Bring your repositories together, inspect their requirements, then work with files, terminals or your preferred agent.'
            )}
          </p>
          <div className="workspace-card-actions">
            <button
              type="button"
              className="workspace-button workspace-button-primary"
              onClick={() => openWorkspacePage('discovery')}
            >
              {translate('workspaceDesktop.discoverAction', 'Discover this project')}
            </button>
            <button type="button" className="workspace-button" onClick={showWorkspaceEditor}>
              {translate('workspaceDesktop.openEditor', 'Open editor')}
            </button>
          </div>
        </section>
        <section className="workspace-card">
          <div className="workspace-eyebrow">
            {translate('workspaceDesktop.continue', 'Continue working')}
          </div>
          <h3>{translate('workspaceDesktop.ideReady', 'Your IDE is ready')}</h3>
          <p>
            {translate(
              'workspaceDesktop.readyCopy',
              'Use your terminal, choose an agent, or attach a development environment.'
            )}
          </p>
          <WorkspaceQuickActions />
        </section>
        <section className="workspace-card">
          <div className="workspace-card-title">
            <h3>{translate('workspaceDesktop.repositoriesTitle', 'Repositories')}</h3>
            <span>
              {repos.length} {translate('workspaceDesktop.attached', 'attached')}
            </span>
          </div>
          {repos.length === 0 ? (
            <div className="workspace-empty">
              <FolderGit2 aria-hidden className="size-6" />
              <p>
                {translate(
                  'workspaceDesktop.emptyRepos',
                  'Add your application, infrastructure or GitOps repository. Everything stays in this workspace.'
                )}
              </p>
              <button type="button" className="workspace-button" onClick={addWorkspaceProject}>
                {translate('workspaceDesktop.addProject', 'Add project')}
              </button>
            </div>
          ) : (
            repos.map((repo) => (
              <button
                type="button"
                className="workspace-repo"
                key={repo.id}
                onClick={() => {
                  const target =
                    byRepo[repo.id]?.[0]?.id ??
                    folders.find(
                      (folder) =>
                        folder.folderPath === repo.path &&
                        getFolderWorkspaceHostId(folder, projectGroups) ===
                          getRepoExecutionHostId(repo)
                    )?.id
                  if (target) {
                    const id = byRepo[repo.id]?.[0]?.id ?? folderWorkspaceKey(target)
                    activateAndRevealWorkspace(id, {
                      executionHostId: getRepoExecutionHostId(repo)
                    })
                    showWorkspaceEditor()
                  } else {
                    useAppStore.getState().openModal('add-repo')
                  }
                }}
              >
                <GitBranch className="size-4" aria-hidden />
                <span>
                  <strong>{repo.displayName}</strong>
                  <small>{repo.path}</small>
                </span>
                <ArrowRight className="size-3" aria-hidden />
              </button>
            ))
          )}
        </section>
        <section className="workspace-card">
          <h3>{translate('workspaceDesktop.connections', 'Project connections')}</h3>
          {(
            [
              [
                'environments',
                translate('workspaceDesktop.developmentEnvironment', 'Development environment'),
                translate('workspaceDesktop.runtimeHelp', 'Where your tools and terminals run'),
                translate('workspaceDesktop.manage', 'Manage')
              ],
              [
                'cloud',
                translate('workspaceDesktop.cloudTarget', 'Cloud target'),
                translate(
                  'workspaceDesktop.cloudHelp',
                  'Connect an existing account when you need it'
                ),
                translate('workspaceDesktop.connect', 'Connect')
              ],
              [
                'delivery',
                translate('workspaceDesktop.deliveryConnections', 'CI, GitOps and monitoring'),
                translate(
                  'workspaceDesktop.deliveryHelp',
                  'Reuse your existing systems and inspect available tools'
                ),
                translate('workspaceDesktop.setupDelivery', 'Set up delivery')
              ]
            ] as const
          ).map(([id, label, description, action]) => (
            <div className="workspace-connection" key={id}>
              <div>
                <strong>{label}</strong>
                <p>{description}</p>
              </div>
              <button
                type="button"
                className="workspace-button"
                onClick={() => openWorkspacePage(id)}
              >
                {action}
              </button>
            </div>
          ))}
        </section>
      </div>
    </div>
  )
}
