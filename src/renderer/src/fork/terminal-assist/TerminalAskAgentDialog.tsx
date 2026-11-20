import { useState } from 'react'
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import type { PaneManager } from '@/lib/pane-manager/pane-manager'
import { readTerminalClipboardSelection } from '@/components/terminal-pane/terminal-clipboard-selection-text'
import { terminalAgentDraft, terminalExcerpt } from '../../../../shared/fork-terminal-excerpt'
import type { ExecutionHostId } from '../../../../shared/execution-host'
import { AssistanceDraftDialog } from '../editor-context/AssistanceDraftDialog'
import { startWorkspaceHost } from '../workbench/start-project-actions'

/** The selection in the pane the menu was opened on, falling back to the active pane. */
export function readMenuPaneSelection(
  manager: Pick<PaneManager, 'getPanes' | 'getActivePane'> | null,
  menuPaneId: number | null
): string {
  const pane =
    manager?.getPanes().find((candidate) => candidate.id === menuPaneId) ??
    manager?.getActivePane() ??
    null
  return pane ? readTerminalClipboardSelection(pane.terminal) : ''
}

export function useTerminalAskAgent(worktreeId: string): {
  ask: (selection: string) => void
  dialog: React.JSX.Element | null
} {
  const [draft, setDraft] = useState<{ text: string; hostId: ExecutionHostId } | null>(null)
  const ask = (selection: string): void => {
    const excerpt = terminalExcerpt(selection)
    if (!excerpt.text) {
      toast.info(
        translate('terminalAssist.empty', 'Select the output you want to ask about first.')
      )
      return
    }
    setDraft({ text: terminalAgentDraft(excerpt), hostId: startWorkspaceHost(worktreeId) })
  }
  return {
    ask,
    dialog: draft ? (
      <AssistanceDraftDialog
        worktreeId={worktreeId}
        hostId={draft.hostId}
        draft={draft.text}
        testId="terminal-ask-agent"
        title={translate('terminalAssist.title', 'Ask an agent about this output')}
        note={translate(
          'terminalAssist.note',
          'Only your selection is used: secrets are redacted and only its last lines are kept. The draft is added to the chat composer unsent; nothing is run.'
        )}
        onClose={() => setDraft(null)}
      />
    ) : null
  }
}
