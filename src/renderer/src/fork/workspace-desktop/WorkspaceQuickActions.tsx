import { useState } from 'react'
import { Plus, Sparkles, SquareTerminal } from 'lucide-react'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import { WorkbenchAgentMenu } from '../workbench/WorkbenchAgentMenu'
import { showWorkbenchTerminals, workbenchGroupId } from '../workbench/workbench-terminals'
import { readWorkbenchFocus } from '../workbench/workbench-focus'
import { setInfraView } from '../devops/infra-home-store'
import { openWorkspacePage } from './workspace-desktop-state'

export function addWorkspaceProject(): void {
  useAppStore.getState().openModal('add-repo')
}
export function showWorkspaceEditor(): void {
  const id = useAppStore.getState().activeWorktreeId
  if (id) {
    setInfraView(id, null)
  }
  openWorkspacePage('editor')
}
export function WorkspaceQuickActions(): React.JSX.Element {
  const id = useAppStore((s) => s.activeWorktreeId)
  const groups = useAppStore((s) => (id ? s.groupsByWorktree[id] : undefined))
  const group = id && groups?.length ? workbenchGroupId(id) : null
  return (
    <div className="workspace-quick-actions">
      <button type="button" className="workspace-button" onClick={addWorkspaceProject}>
        <Plus aria-hidden className="size-3" />
        {translate('workspaceDesktop.project', 'Project')}
      </button>
      <button
        type="button"
        className="workspace-button"
        onClick={() => {
          if (!id || !group) {
            return addWorkspaceProject()
          }
          showWorkspaceEditor()
          // Orca opens a first terminal with the project; show it instead of adding a duplicate.
          if (readWorkbenchFocus(id) !== 'terminal') {
            showWorkbenchTerminals(id)
          }
        }}
      >
        <SquareTerminal className="size-3" aria-hidden />
        {translate('workspaceDesktop.terminal', 'Terminal')}
      </button>
      {id && group ? (
        <AgentAction key={`${id}:${group}`} worktreeId={id} groupId={group} />
      ) : (
        <button
          type="button"
          className="workspace-button workspace-button-primary"
          onClick={addWorkspaceProject}
        >
          <Sparkles className="size-3" aria-hidden />
          {translate('workspaceDesktop.launchAgent', 'Launch agent')}
        </button>
      )}
    </div>
  )
}
function AgentAction({
  worktreeId,
  groupId
}: {
  worktreeId: string
  groupId: string
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <WorkbenchAgentMenu
      worktreeId={worktreeId}
      groupId={groupId}
      open={open}
      onOpenChange={setOpen}
      onLaunched={showWorkspaceEditor}
    >
      <button type="button" className="workspace-button workspace-button-primary">
        <Sparkles className="size-3" aria-hidden />
        {translate('workspaceDesktop.launchAgent', 'Launch agent')}
      </button>
    </WorkbenchAgentMenu>
  )
}
