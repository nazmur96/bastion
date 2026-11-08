import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import { RightSidebarPanelContent } from '@/components/right-sidebar/right-sidebar-panel-content'
import { liveTerminalDockId } from './terminal-dock'
import { useSideSection } from './side-panel-store'
import { HidePaneSurfaces } from './HidePaneSurfaces'

/** The pages this workspace opened (Argo CD, Grafana, the app); each opens as a middle tab. */
function BrowserPages({ worktreeId }: { worktreeId: string }): React.JSX.Element {
  // Select the stable tab list, filter after: a filtered selector result is new on every read.
  const tabs = useAppStore((state) => state.unifiedTabsByWorktree[worktreeId])
  const pages = (tabs ?? []).filter((tab) => tab.contentType === 'browser')
  return (
    <div className="flex flex-col gap-2 p-3">
      <div className="bx-side-label">
        {translate('components.sidePanel.pages', 'Pages this project opened')}
      </div>
      {pages.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {translate(
            'components.sidePanel.noPages',
            'None yet. Argo CD, Grafana and the app open here once a step starts them.'
          )}
        </p>
      ) : (
        pages.map((page) => (
          <button
            type="button"
            key={page.id}
            className="bx-side-page"
            onClick={() => useAppStore.getState().activateTab(page.id, { worktreeId })}
          >
            {page.label ||
              page.customLabel ||
              translate('components.sidePanel.page', 'Browser tab')}
          </button>
        ))
      )}
    </div>
  )
}

/** Covers the side panel's terminals with the chosen section: Orca's own file tree, source
 *  control and checks, or the project's pages. Terminals keep running underneath. */
export function SidePanelOverlay({
  worktreeId,
  groupId
}: {
  worktreeId: string
  groupId: string
}): React.JSX.Element | null {
  const isDock = useAppStore(() => liveTerminalDockId(worktreeId) === groupId)
  const section = useSideSection(worktreeId)
  if (!isDock || section === 'terminal') {
    return null
  }
  return (
    <div
      className="absolute inset-0 z-30 flex flex-col overflow-y-auto bg-background scrollbar-sleek"
      data-side-panel={section}
    >
      <HidePaneSurfaces groupId={groupId} />
      {section === 'browser' ? (
        <BrowserPages worktreeId={worktreeId} />
      ) : (
        <RightSidebarPanelContent
          effectiveTab={
            section === 'files' ? 'explorer' : section === 'changes' ? 'source-control' : 'checks'
          }
          rightSidebarOpen
        />
      )}
    </div>
  )
}
