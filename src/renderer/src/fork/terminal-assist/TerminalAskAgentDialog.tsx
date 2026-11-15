import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import { isStructuredTab } from '../../../../shared/structured-agent-session-tab'
import { structuredAgentSessionOwnerForTab } from '@/runtime/structured-agent-session-owner'
import {
  terminalAgentDraft,
  terminalExcerpt,
  type TerminalExcerpt
} from '../../../../shared/fork-terminal-excerpt'
import { draftAssistanceInOpenChat } from '../editor-context/assistance-chat-draft'
import { startWorkspaceHost } from '../workbench/start-project-actions'
import type { PaneManager } from '@/lib/pane-manager/pane-manager'
import { readTerminalClipboardSelection } from '@/components/terminal-pane/terminal-clipboard-selection-text'

/**
 * Selected terminal output → an unsent draft in one of this workspace's agent chats, or the
 * clipboard. The engineer chooses the excerpt; nothing is sent, launched or run.
 */
function TerminalAskAgentDialog({
  worktreeId,
  excerpt,
  onClose
}: {
  worktreeId: string
  excerpt: TerminalExcerpt
  onClose: () => void
}): React.JSX.Element {
  const hostId = startWorkspaceHost(worktreeId)
  const tabs = useAppStore((state) => state.unifiedTabsByWorktree[worktreeId])
  const chats = (tabs ?? []).filter(
    (tab) =>
      isStructuredTab(tab) &&
      structuredAgentSessionOwnerForTab(useAppStore.getState(), tab) === hostId
  )
  const [chatId, setChatId] = useState(chats[0]?.id ?? 'copy')
  const draft = terminalAgentDraft(excerpt)
  const deliver = (): void => {
    if (chatId === 'copy') {
      // The renderer's Clipboard API is permission-denied in Orca; use the app's clipboard bridge.
      void window.api.ui.writeClipboardText(draft).then(
        () =>
          toast.success(
            translate('terminalAssist.copied', 'Draft copied. Review it before sending.')
          ),
        () => toast.error(translate('terminalAssist.copyFailed', 'Could not copy the draft.'))
      )
      onClose()
      return
    }
    const delivered = draftAssistanceInOpenChat(
      worktreeId,
      chatId,
      hostId,
      draft,
      () => useAppStore.getState().activeWorktreeId === worktreeId
    )
    if (!delivered) {
      toast.error(
        translate('terminalAssist.refused', 'That chat is no longer available here. Pick another.')
      )
      return
    }
    onClose()
  }
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent data-testid="terminal-ask-agent">
        <DialogHeader>
          <DialogTitle>
            {translate('terminalAssist.title', 'Ask an agent about this output')}
          </DialogTitle>
        </DialogHeader>
        <textarea
          className="min-h-40 w-full rounded-md border border-input bg-background p-2 font-mono text-xs"
          aria-label={translate('terminalAssist.preview', 'Unsent draft')}
          value={draft}
          readOnly
        />
        <p className="text-xs text-muted-foreground">
          {translate(
            'terminalAssist.note',
            'Only your selection is used: secrets are redacted and only its last lines are kept. The draft is added to the chat composer unsent; nothing is run.'
          )}
        </p>
        <Select value={chatId} onValueChange={setChatId}>
          <SelectTrigger aria-label={translate('terminalAssist.destination', 'Draft destination')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {chats.map((tab) => (
              <SelectItem key={tab.id} value={tab.id}>
                {tab.agentSessionAgent} · {tab.label}
              </SelectItem>
            ))}
            <SelectItem value="copy">
              {translate('terminalAssist.copyDestination', 'Copy for any agent')}
            </SelectItem>
          </SelectContent>
        </Select>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            {translate('terminalAssist.cancel', 'Cancel')}
          </Button>
          <Button onClick={deliver}>
            {chatId === 'copy'
              ? translate('terminalAssist.copy', 'Copy draft')
              : translate('terminalAssist.append', 'Add to chat draft')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

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

/** Opens the dialog for a selection; an empty selection only explains what to do. */
export function useTerminalAskAgent(worktreeId: string): {
  ask: (selection: string) => void
  dialog: React.JSX.Element | null
} {
  const [excerpt, setExcerpt] = useState<TerminalExcerpt | null>(null)
  const ask = (selection: string): void => {
    const next = terminalExcerpt(selection)
    if (!next.text) {
      toast.info(
        translate('terminalAssist.empty', 'Select the output you want to ask about first.')
      )
      return
    }
    setExcerpt(next)
  }
  return {
    ask,
    dialog: excerpt ? (
      <TerminalAskAgentDialog
        worktreeId={worktreeId}
        excerpt={excerpt}
        onClose={() => setExcerpt(null)}
      />
    ) : null
  }
}
