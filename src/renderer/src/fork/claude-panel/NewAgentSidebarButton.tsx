import { Plus } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { useState } from 'react'
import { WorkbenchAgentMenu } from '../workbench/WorkbenchAgentMenu'
import { workbenchGroupId } from '../workbench/workbench-terminals'

function AgentButton({ worktreeId }: { worktreeId: string | null }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const groups = useAppStore((s) => (worktreeId ? s.groupsByWorktree[worktreeId] : undefined))
  const groupId = worktreeId && groups?.length ? workbenchGroupId(worktreeId) : null
  const button = (
    <button
      type="button"
      disabled={!groupId}
      className="mb-1 flex w-full items-center justify-center gap-1.5 rounded-md border border-worktree-sidebar-border px-2 py-1.5 text-[13px] font-medium text-worktree-sidebar-foreground transition-colors hover:bg-worktree-sidebar-foreground/8 disabled:opacity-50"
    >
      <Plus className="size-4 shrink-0" strokeWidth={1.75} aria-hidden />
      <span>{translate('components.claudePanel.newAgent', 'New agent')}</span>
    </button>
  )
  return worktreeId && groupId ? (
    <WorkbenchAgentMenu
      key={`${worktreeId}:${groupId}`}
      worktreeId={worktreeId}
      groupId={groupId}
      open={open}
      onOpenChange={setOpen}
    >
      {button}
    </WorkbenchAgentMenu>
  ) : (
    button
  )
}

export function NewAgentSidebarButton(): React.JSX.Element {
  const worktreeId = useAppStore((s) => s.activeWorktreeId)
  return <AgentButton key={worktreeId} worktreeId={worktreeId} />
}
