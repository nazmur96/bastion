import { Globe, FileText, GitCompare, Server, SquareTerminal } from 'lucide-react'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { selectKnownWorktreeById } from '@/store/selectors'
import type { TabContentType } from '../../../../shared/tab-types'
import { useClaudePanelState } from '../claude-panel/claude-panel-registry'
import { DevopsToolbelt } from '../devops/DevopsToolbelt'
import { setInfraHomeOpen, useInfraHomeOpen } from '../devops/infra-home-store'
import {
  WORKBENCH_SECTIONS,
  filterWorkbenchLists,
  latestTabInSection,
  sectionCounts,
  sectionOfContentType,
  type WorkbenchSection
} from './workbench-sections'

type SectionModel = {
  activeTab: { contentType: TabContentType } | null
  groupTabs: readonly { id: string; contentType: TabContentType }[]
  terminalTabs: readonly unknown[]
  agentSessionItems: readonly unknown[]
  editorItems: readonly { tabId: string }[]
  browserItems: readonly unknown[]
  commands: { newTerminalTab: () => void; newBrowserTab: () => void }
}

/** The Claude panel and side-chat panes hold only chats; they keep their plain tab strip. */
function useIsChatGroup(
  worktreeId: string,
  groupId: string,
  groupTabs: readonly { contentType: TabContentType }[]
): boolean {
  const isPanel = useClaudePanelState().groupIdByWorktree[worktreeId] === groupId
  return (
    isPanel ||
    (groupTabs.length > 0 && groupTabs.every((tab) => tab.contentType === 'agent-session'))
  )
}

function currentSection(model: Pick<SectionModel, 'activeTab'>): WorkbenchSection {
  return model.activeTab ? sectionOfContentType(model.activeTab.contentType) : 'files'
}

/** The editor-area group shows one section's tabs at a time; the Claude panel is left as is. */
export function useWorkbenchSections<M extends SectionModel>(
  model: M,
  worktreeId: string,
  groupId: string
): M {
  const isPanel = useIsChatGroup(worktreeId, groupId, model.groupTabs)
  return isPanel
    ? model
    : { ...model, ...filterWorkbenchLists(model, model.groupTabs, currentSection(model)) }
}

const LABELS: Record<WorkbenchSection, () => string> = {
  terminals: () => translate('components.workbench.terminals', 'Terminals'),
  files: () => translate('components.workbench.files', 'Files'),
  changes: () => translate('components.workbench.changes', 'Changes'),
  browser: () => translate('components.workbench.browser', 'Browser')
}

const ICONS: Record<WorkbenchSection, typeof SquareTerminal> = {
  terminals: SquareTerminal,
  files: FileText,
  changes: GitCompare,
  browser: Globe
}

function openEmptySection(
  section: WorkbenchSection,
  worktreeId: string,
  model: SectionModel
): void {
  const state = useAppStore.getState()
  if (section === 'terminals') {
    model.commands.newTerminalTab()
  } else if (section === 'browser') {
    model.commands.newBrowserTab()
  } else if (section === 'files') {
    state.openModal('quick-open')
  } else {
    const path = selectKnownWorktreeById(state, worktreeId)?.path
    if (path) {
      state.openAllDiffs(worktreeId, path)
    }
  }
}

export function WorkbenchSectionBar({
  worktreeId,
  groupId,
  model
}: {
  worktreeId: string
  groupId: string
  model: SectionModel
}): React.JSX.Element | null {
  const isPanel = useIsChatGroup(worktreeId, groupId, model.groupTabs)
  const recentTabIds = useAppStore(
    (s) => s.groupsByWorktree?.[worktreeId]?.find((group) => group.id === groupId)?.recentTabIds
  )
  const infraOpen = useInfraHomeOpen(worktreeId)
  if (isPanel) {
    return null
  }
  const active = infraOpen ? null : currentSection(model)
  const counts = sectionCounts(model.groupTabs)
  const choose = (section: WorkbenchSection): void => {
    setInfraHomeOpen(worktreeId, false)
    const tabId = latestTabInSection(model.groupTabs, recentTabIds ?? [], section)
    if (tabId) {
      useAppStore.getState().activateTab(tabId, { worktreeId })
    } else {
      openEmptySection(section, worktreeId, model)
    }
  }
  return (
    <div
      className="flex h-full shrink-0 items-center gap-0.5 border-r border-border pr-1.5 pl-1"
      data-workbench-sections={groupId}
    >
      <button
        type="button"
        aria-pressed={infraOpen}
        onClick={() => setInfraHomeOpen(worktreeId, !infraOpen)}
        title={translate(
          'components.workbench.infraHint',
          'Context, readiness, sandbox and actions for this repo'
        )}
        className={cn(
          'flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground',
          infraOpen && 'bg-accent text-primary'
        )}
        data-workbench-infra=""
      >
        <Server className="size-3.5" aria-hidden />
        <span>{translate('components.workbench.infra', 'Infra')}</span>
      </button>
      {WORKBENCH_SECTIONS.map((section) => {
        const Icon = ICONS[section]
        return (
          <button
            key={section}
            type="button"
            aria-pressed={section === active}
            onClick={() => choose(section)}
            className={cn(
              'flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground',
              section === active && 'bg-accent text-primary'
            )}
          >
            <Icon className="size-3.5" aria-hidden />
            <span>{LABELS[section]()}</span>
            {counts[section] > 0 ? (
              <span className="text-[10px] opacity-70">{counts[section]}</span>
            ) : null}
          </button>
        )
      })}
      <DevopsToolbelt worktreeId={worktreeId} />
    </div>
  )
}
