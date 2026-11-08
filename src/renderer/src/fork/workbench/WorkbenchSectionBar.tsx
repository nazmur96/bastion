import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import { setInfraView, useInfraView } from '../devops/infra-home-store'
import {
  FileText,
  GitBranch,
  Globe,
  ListChecks,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  SquareTerminal
} from 'lucide-react'
import { togglePathColumn, usePathColumnCollapsed } from '../devops/path-column-store'
import { isSidePanelCollapsed, liveTerminalDockId, toggleSidePanel } from './terminal-dock'
import {
  useOnlyTerminalsInDock,
  useTerminalsInDock,
  useWorkbenchAboveDock
} from './use-terminal-dock'
import { workbenchGroupId } from './workbench-terminals'
import { SIDE_SECTIONS, setSideSection, useSideSection, type SideSection } from './side-panel-store'

const SECTION_ICONS: Record<SideSection, typeof FileText> = {
  files: FileText,
  changes: GitBranch,
  terminal: SquareTerminal,
  browser: Globe,
  checks: ListChecks
}

function SectionIcon({ section }: { section: SideSection }): React.JSX.Element {
  const Icon = SECTION_ICONS[section]
  return <Icon aria-hidden />
}

function sectionLabel(section: SideSection): string {
  switch (section) {
    case 'files':
      return translate('components.sidePanel.files', 'Files')
    case 'changes':
      return translate('components.sidePanel.changes', 'Changes')
    case 'terminal':
      return translate('components.sidePanel.terminal', 'Terminal')
    case 'browser':
      return translate('components.sidePanel.browser', 'Browser')
    case 'checks':
      return translate('components.sidePanel.checks', 'Checks')
  }
}

/** In the workbench, the tab of the view the Project path opened; in the side panel, its
 *  section buttons. */
export function WorkbenchSectionBar({
  worktreeId,
  groupId
}: {
  worktreeId: string
  groupId: string
}): React.JSX.Element | null {
  const role = useAppStore(() =>
    workbenchGroupId(worktreeId) === groupId
      ? 'workbench'
      : liveTerminalDockId(worktreeId) === groupId
        ? 'dock'
        : null
  )
  const view = useInfraView(worktreeId)
  const sideCollapsed = useAppStore(() => isSidePanelCollapsed(worktreeId))
  const pathCollapsed = usePathColumnCollapsed()
  const section = useSideSection(worktreeId)
  useTerminalsInDock(worktreeId, role === 'workbench' ? groupId : null)
  useWorkbenchAboveDock(worktreeId, role === 'dock' ? groupId : null)
  useOnlyTerminalsInDock(worktreeId, role === 'dock' ? groupId : null)
  if (role === 'dock') {
    return (
      <nav
        className="bx-rail"
        aria-label={translate('components.sidePanel.label', 'Side panel')}
        data-terminal-dock-label=""
        data-side-section={section}
      >
        {SIDE_SECTIONS.map((id) => (
          <button
            type="button"
            key={id}
            className="bx-rail-btn"
            aria-pressed={section === id}
            title={sectionLabel(id)}
            aria-label={sectionLabel(id)}
            onClick={() => setSideSection(worktreeId, id)}
          >
            <SectionIcon section={id} />
            <span className="lbl">{sectionLabel(id)}</span>
          </button>
        ))}
        <button
          type="button"
          className="bx-icon-btn ml-auto"
          aria-label={translate('components.sidePanel.hide', 'Hide side panel')}
          title={translate('components.sidePanel.hide', 'Hide side panel')}
          onClick={() => toggleSidePanel(worktreeId)}
        >
          <PanelRightClose aria-hidden />
        </button>
      </nav>
    )
  }
  if (role !== 'workbench') {
    return null
  }
  // Hidden, the side panel leaves its open button where it was: the right end of this row.
  const restore = sideCollapsed ? (
    <button
      type="button"
      className="bx-icon-btn bx-side-restore"
      aria-label={translate('components.sidePanel.show', 'Show side panel')}
      title={translate('components.sidePanel.show', 'Show side panel')}
      onClick={() => toggleSidePanel(worktreeId)}
    >
      <PanelRightOpen aria-hidden />
    </button>
  ) : null
  const restorePath = pathCollapsed ? (
    <button
      type="button"
      className="bx-icon-btn bx-path-restore"
      aria-label={translate('components.devops.path.expand', 'Show Project path')}
      title={translate('components.devops.path.expand', 'Show Project path')}
      onClick={togglePathColumn}
    >
      <PanelLeftOpen aria-hidden />
    </button>
  ) : null
  if (!view) {
    return (
      <>
        {restorePath}
        {restore}
      </>
    )
  }
  // The view the Project path opened reads as the open tab, ahead of chat and files.
  return (
    <>
      {restorePath}
      {restore}
      <span className="bx-tab" aria-current="page" data-workbench-infra="" data-open="true">
        <span>
          {view === 'map'
            ? translate('components.workbench.fullMap', 'System map')
            : translate('components.workbench.tools', 'Tools & settings')}
        </span>
        <button
          type="button"
          className="bx-tab-close"
          aria-label={translate('components.workbench.closeView', 'Close')}
          onClick={() => setInfraView(worktreeId, null)}
        >
          ×
        </button>
      </span>
    </>
  )
}
