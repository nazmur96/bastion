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
import type { ExecutionHostId } from '../../../../shared/execution-host'
import { structuredAgentSessionOwnerForTab } from '@/runtime/structured-agent-session-owner'
import { draftAssistanceInOpenChat } from './assistance-chat-draft'

export function AssistanceDraftDialog({
  worktreeId,
  hostId,
  draft,
  title,
  note,
  testId,
  isCurrent,
  onClose,
  onDraftAdded
}: {
  worktreeId: string
  hostId: ExecutionHostId
  draft: string
  title: string
  note: string
  testId?: string
  isCurrent?: () => boolean
  onClose: () => void
  onDraftAdded?: () => void
}): React.JSX.Element {
  const tabs = useAppStore((state) => state.unifiedTabsByWorktree[worktreeId])
  const chats = (tabs ?? []).filter(
    (tab) =>
      isStructuredTab(tab) &&
      structuredAgentSessionOwnerForTab(useAppStore.getState(), tab) === hostId
  )
  const [chatId, setChatId] = useState(chats[0]?.id ?? 'copy')
  const deliver = (): void => {
    if (isCurrent && !isCurrent()) {
      toast.error(translate('assistanceDraft.stale', 'This draft is out of date. Open a new one.'))
      onClose()
      return
    }
    if (chatId === 'copy') {
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
    if (!draftAssistanceInOpenChat(worktreeId, chatId, hostId, draft, isCurrent ?? (() => true))) {
      toast.error(
        translate('terminalAssist.refused', 'That chat is no longer available here. Pick another.')
      )
      return
    }
    onClose()
    onDraftAdded?.()
  }
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent data-testid={testId}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <textarea
          className="min-h-40 w-full rounded-md border border-input bg-background p-2 font-mono text-xs"
          aria-label={translate('terminalAssist.preview', 'Unsent draft')}
          value={draft}
          readOnly
        />
        <p className="text-xs text-muted-foreground">{note}</p>
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
