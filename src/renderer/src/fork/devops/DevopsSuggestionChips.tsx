import { Play } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAppStore } from '@/store'
import { useEditorContextEntry } from '../editor-context/editor-context-store'
import { runInWorkbenchTerminal } from '../workbench/workbench-terminals'
import { useDevopsInspection } from './use-devops-inspection'
import { rankDevopsActions } from '../../../../shared/fork-devops-actions'
import { stackOfWorkspaceFile } from '../../../../shared/fork-devops-stacks'
import { devopsCommandLine } from '../../../../shared/fork-devops-inspection'
import { devopsSuggestionsForText } from '../../../../shared/fork-devops-suggestions'

function Chips({
  worktreeId,
  text
}: {
  worktreeId: string
  text: string
}): React.JSX.Element | null {
  const inspection = useDevopsInspection(worktreeId)
  const editor = useEditorContextEntry(worktreeId)
  if (!inspection || inspection.findings.length === 0) {
    return null
  }
  const activeFile = editor
    ? { path: editor.file, stack: stackOfWorkspaceFile(editor.file, inspection.findings) }
    : undefined
  const available = rankDevopsActions({ findings: inspection.findings, activeFile }).filter(
    (item) => inspection.tools[item.action.tool]?.available !== false
  )
  const suggestions = devopsSuggestionsForText(text, available)
  if (suggestions.length === 0) {
    return null
  }
  return (
    <div className="mt-2 flex flex-wrap gap-1.5 select-none" data-devops-suggestions="">
      {suggestions.map((item) => (
        <Button
          key={item.action.id}
          type="button"
          variant="outline"
          size="xs"
          title={item.command}
          onClick={() =>
            runInWorkbenchTerminal(
              worktreeId,
              devopsCommandLine(inspection.tools[item.action.tool], item.command, inspection.shell)
            )
          }
        >
          <Play aria-hidden />
          {item.action.description.split(':')[0]}
        </Button>
      ))}
    </div>
  )
}

/** F1: one-click Toolbelt actions for what a finished Claude reply talks about. */
export function DevopsSuggestionChips({ text }: { text: string }): React.JSX.Element | null {
  const worktreeId = useAppStore((state) => state.activeWorktreeId)
  return worktreeId ? <Chips worktreeId={worktreeId} text={text} /> : null
}
