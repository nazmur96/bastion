import { hasMacTrafficLights } from '@/app-shell/app-window-chrome'
import { PanelLeft, Search } from 'lucide-react'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import { ShortcutKeyCombo } from '@/components/ShortcutKeyCombo'
import { useShortcutKeyComboDetails } from '@/hooks/useShortcutLabel'
import logo from '../../../../../resources/icon-source/bastion.svg'
import { useProjectWorkspaces } from '../project-workspaces/use-project-workspaces'
import { StartEnvironmentPicker } from '../workbench/StartEnvironmentPicker'
import { WorkspaceQuickActions } from './WorkspaceQuickActions'
import { openWorkspacePage, useWorkspacePage } from './workspace-desktop-state'
import { workspaceNavigation } from './workspace-navigation'

export function WorkspaceDesktopTopbar(): React.JSX.Element {
  const combos = useShortcutKeyComboDetails('worktree.palette')
  return (
    <header className="workspace-topbar">
      {hasMacTrafficLights && <div className="titlebar-traffic-light-pad" />}
      <button
        type="button"
        className="workspace-brand"
        aria-label={translate('auto.App.8b0b8eb54f', 'Application menu')}
        onClick={() => window.api.ui.popupMenu()}
      >
        <img src={logo} alt="" />
        <strong>BASTION</strong>
      </button>
      <span className="workspace-brand-subtitle">
        {translate('workspaceDesktop.engineering', 'Engineering workspace')}
      </span>
      <button
        type="button"
        className="workspace-search"
        onClick={() => useAppStore.getState().openModal('worktree-palette')}
      >
        <Search className="size-3" aria-hidden />
        <span>
          {translate('workspaceDesktop.search', 'Find a project, worktree or browser tab')}
        </span>
        {combos[0] && <ShortcutKeyCombo keys={combos[0].keys} doubleTap={combos[0].doubleTap} />}
      </button>
      <button
        type="button"
        className="workspace-button"
        onClick={() => useAppStore.getState().toggleSidebar()}
        aria-label={translate('auto.App.e4b9e7dff7', 'Toggle sidebar')}
      >
        <PanelLeft className="size-4" aria-hidden />
      </button>
    </header>
  )
}
export function WorkspaceDesktopBar(): React.JSX.Element {
  const page = useWorkspacePage()
  const { snapshot } = useProjectWorkspaces()
  const id = useAppStore((s) => s.activeWorktreeId)
  const name = snapshot?.workspaces.find((entry) => entry.id === snapshot.activeId)?.name ?? ''
  const title = workspaceNavigation().find((item) => item.id === page)?.label
  return (
    <div className="workspace-chrome">
      <div className="workspace-context-bar">
        <span>{translate('workspaceDesktop.workspace', 'workspace')}</span>
        <span>/</span>
        <strong>{name}</strong>
        <div className="workspace-runtime">
          <span className="workspace-eyebrow">
            {translate('workspaceDesktop.execution', 'Execution')}
          </span>
          {id ? (
            <StartEnvironmentPicker workspaceId={id} />
          ) : (
            <span>{translate('workspaceDesktop.noProject', 'Choose a project')}</span>
          )}
          <span className="workspace-context-divider" />
          <button type="button" onClick={() => openWorkspacePage('cloud')}>
            {translate('workspaceDesktop.cloudTarget', 'Cloud target')}
            <span>↗</span>
          </button>
        </div>
      </div>
      <div className="workspace-surface-bar">
        <span className="workspace-surface-tab">{title}</span>
        <span className="workspace-surface-caption">
          {translate('workspaceDesktop.context', 'Your project, kept together')}
        </span>
        <WorkspaceQuickActions />
      </div>
    </div>
  )
}
