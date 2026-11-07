import { Plus } from 'lucide-react'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { launchClaudeChatInPanel } from './ensure-claude-panel'
import { workbenchGroupId } from '../workbench/workbench-terminals'

/** Bastion keeps chats in the middle: a new agent is a new chat tab there, composer focused. */
function startNewAgent(worktreeId: string): void {
  const middle = workbenchGroupId(worktreeId)
  if (middle) {
    launchClaudeChatInPanel(worktreeId, middle, { focusComposer: true })
  }
}

/** Cursor's "New agent": a fresh Claude chat in the current workspace. */
export function NewAgentSidebarButton(): React.JSX.Element {
  const worktreeId = useAppStore((s) => s.activeWorktreeId)
  return (
    <button
      type="button"
      disabled={!worktreeId}
      onClick={() => {
        if (worktreeId) {
          startNewAgent(worktreeId)
        }
      }}
      className="mb-1 flex w-full items-center justify-center gap-1.5 rounded-md border border-worktree-sidebar-border px-2 py-1.5 text-[13px] font-medium text-worktree-sidebar-foreground transition-colors hover:bg-worktree-sidebar-foreground/8 disabled:opacity-50"
    >
      <Plus className="size-4 shrink-0" strokeWidth={1.75} aria-hidden />
      <span>{translate('components.claudePanel.newAgent', 'New agent')}</span>
    </button>
  )
}
