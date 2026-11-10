import { Maximize2, Minimize2 } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'
import {
  toggleWorkbenchFocus,
  useWorkbenchFocus,
  type WorkbenchFocusTarget
} from './workbench-focus'

export function WorkbenchFocusButton({
  worktreeId,
  target
}: {
  worktreeId: string
  target: WorkbenchFocusTarget
}): React.JSX.Element {
  const focused = useWorkbenchFocus(worktreeId) === target
  const label = focused
    ? translate('components.workbench.restoreLayout', 'Restore previous layout')
    : target === 'terminal'
      ? translate('components.workbench.focusTerminal', 'Focus terminal')
      : translate('components.workbench.focusMain', 'Focus editor or agent')
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="bx-icon-btn bx-focus-toggle"
          aria-label={label}
          aria-pressed={focused}
          onClick={() => toggleWorkbenchFocus(worktreeId, target)}
        >
          {focused ? <Minimize2 aria-hidden /> : <Maximize2 aria-hidden />}
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={4}>
        {label}
      </TooltipContent>
    </Tooltip>
  )
}
