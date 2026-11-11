import { useRef, useState, type ReactNode } from 'react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import {
  ProjectedAgentMenuItems,
  useTabAgentMenuLaunch
} from '@/components/tab-bar/QuickLaunchButton'
import { useNewTabAgentMenuRows } from '@/components/tab-bar/use-new-tab-agent-menu-rows'
import { useAgentLaunchPickerInventory } from '@/components/agent/use-agent-launch-picker-inventory'
import { useAgentDetectionTargetForWorktree } from '@/hooks/useAgentDetectionTarget'
import { focusTerminalTabSurface } from '@/lib/focus-terminal-tab-surface'
import { requestNativeChatComposerFocus } from '@/components/native-chat/use-native-chat-composer-reveal-focus'
import type { AgentPickerEntry } from '../../../../shared/agent-launch-picker'

export function WorkbenchAgentMenu({
  worktreeId,
  groupId,
  children,
  prompt,
  onPromptDelivered,
  open,
  onOpenChange
}: {
  worktreeId: string
  groupId: string
  children: ReactNode
  prompt?: string
  onPromptDelivered?: () => void
  open: boolean
  onOpenChange: (open: boolean) => void
}): React.JSX.Element {
  const [selected, setSelected] = useState<AgentPickerEntry['agent']>()
  const pendingFocus = useRef<(() => void) | null>(null)
  const target = useAgentDetectionTargetForWorktree(worktreeId)
  const model = useNewTabAgentMenuRows(worktreeId, open, target, { wakeOnOpen: true })
  const entries = useAgentLaunchPickerInventory(worktreeId, model, open, selected)
  const launch = useTabAgentMenuLaunch({
    worktreeId,
    groupId,
    prompt,
    promptDelivery: 'draft',
    onPromptDelivered,
    onFocusTerminal: (tabId) => {
      pendingFocus.current = () => focusTerminalTabSurface(tabId)
    },
    onFocusChat: (tabId) => {
      pendingFocus.current = () => requestNativeChatComposerFocus(tabId)
    }
  })
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        onCloseAutoFocus={(event) => {
          const focus = pendingFocus.current
          pendingFocus.current = null
          if (focus) {
            event.preventDefault()
            focus()
          }
        }}
      >
        <ProjectedAgentMenuItems
          model={model}
          pickerEntries={entries}
          onSelectPickerAgent={setSelected}
          runLaunch={launch}
        />
      </DropdownMenuContent>
      {open && <style>{'[data-retained-group]{visibility:hidden}'}</style>}
    </DropdownMenu>
  )
}
