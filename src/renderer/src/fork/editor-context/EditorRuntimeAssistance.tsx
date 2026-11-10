import { useMemo } from 'react'
import { Sparkles, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import { useDevopsInspection } from '../devops/use-devops-inspection'
import { useDeckCommands } from '../devops/command-deck-store'
import { draftForClaude } from '../devops/ask-claude'
import { startWorkspaceHost } from '../workbench/start-project-actions'
import { readEditorContextEntry, useEditorContextEntry } from './editor-context-store'
import {
  runtimeAssistanceForFile,
  runtimeAssistanceKey,
  setRuntimeAssistanceDismissed,
  useRuntimeAssistanceDismissed,
  type RuntimeAssistance
} from './editor-runtime-assistance'

export function EditorRuntimeAssistance({
  worktreeId,
  relativePath,
  enabled
}: {
  worktreeId: string | undefined
  relativePath: string
  enabled: boolean
}): React.JSX.Element | null {
  const active = useAppStore((state) => state.activeWorktreeId === worktreeId)
  const local = useAppStore(() => Boolean(worktreeId && startWorkspaceHost(worktreeId) === 'local'))
  const editor = useEditorContextEntry(worktreeId)
  if (!enabled || !worktreeId || !active || !local || editor?.file !== relativePath) {
    return null
  }
  return (
    <LocalRuntimeAssistance
      key={`${worktreeId}:${relativePath}`}
      worktreeId={worktreeId}
      relativePath={relativePath}
    />
  )
}

function LocalRuntimeAssistance({
  worktreeId,
  relativePath
}: {
  worktreeId: string
  relativePath: string
}): React.JSX.Element | null {
  const inspection = useDevopsInspection(worktreeId)
  const suggestion = runtimeAssistanceForFile(relativePath, inspection)
  return suggestion ? (
    <RuntimeHint worktreeId={worktreeId} file={relativePath} suggestion={suggestion} />
  ) : null
}

function RuntimeHint({
  worktreeId,
  file,
  suggestion
}: {
  worktreeId: string
  file: string
  suggestion: RuntimeAssistance
}): React.JSX.Element | null {
  const key = runtimeAssistanceKey(worktreeId, file, suggestion)
  const dismissed = useRuntimeAssistanceDismissed(key)
  const commands = useMemo(
    () => [
      {
        id: 'assistance:runtime',
        group: translate('components.assistance.commandGroup', 'Editor assistance'),
        label: translate('components.assistance.restore', 'Show assistance for this file'),
        keywords: ['terraform', 'suggestion', 'context', 'setup'],
        run: () => setRuntimeAssistanceDismissed(key, false)
      }
    ],
    [key]
  )
  useDeckCommands(`editor-assistance:${key}`, commands)
  if (dismissed) {
    return null
  }
  const dismiss = translate('components.assistance.dismiss', 'Dismiss assistance for this file')
  const draft = (): void => {
    const isCurrent = (): boolean =>
      useAppStore.getState().activeWorktreeId === worktreeId &&
      startWorkspaceHost(worktreeId) === 'local' &&
      readEditorContextEntry(worktreeId)?.file === file
    draftForClaude(
      worktreeId,
      `Review Terraform tooling and next steps for ${JSON.stringify(file)} in this workspace. ` +
        `The last local workspace inspection reported the Terraform CLI ${suggestion.available ? 'available' : 'not found'}. ` +
        'Confirm the execution environment and source before recommending anything. ' +
        'Use the declared dev environment for project tools; do not install on the host. ' +
        'Explain a minimal proposal. Do not run commands, install tools or contact cloud services.',
      0,
      isCurrent
    )
  }
  return (
    <div
      className="absolute right-3 bottom-3 z-20 flex items-center gap-1 rounded-md border border-border bg-popover text-popover-foreground shadow-xs"
      data-editor-runtime-assistance=""
    >
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="xs">
            <Sparkles className="size-4" aria-hidden />
            {suggestion.available
              ? translate('components.assistance.terraform', 'Terraform assistance')
              : translate('components.assistance.terraformMissing', 'Review Terraform setup')}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" side="top">
          <div className="w-80 space-y-3 p-3" data-runtime-assistance-details="">
            <h3 className="text-sm font-medium">
              {translate('components.assistance.title', 'Assistance for this file')}
            </h3>
            <p className="break-all font-mono text-xs text-muted-foreground">{file}</p>
            <p className="text-sm">
              {suggestion.available
                ? translate(
                    'components.assistance.available',
                    'The last local workspace inspection found the Terraform CLI.'
                  )
                : translate(
                    'components.assistance.missing',
                    'The last local workspace inspection did not find the Terraform CLI. Review the declared development environment before setting it up.'
                  )}
            </p>
            <p className="text-xs text-muted-foreground">
              {translate(
                'components.assistance.scope',
                'This is a CLI lookup, not a language-server or infrastructure check. This hint does not send model requests or run Terraform.'
              )}
            </p>
            <Button variant="secondary" size="sm" onClick={draft}>
              {translate('components.assistance.draft', 'Draft a request for Claude')}
            </Button>
            <p className="text-xs text-muted-foreground">
              {translate(
                'components.assistance.draftHint',
                'Opens an unsent request in this workspace. Review it before sending.'
              )}
            </p>
          </div>
        </PopoverContent>
      </Popover>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label={dismiss}
            onClick={() => setRuntimeAssistanceDismissed(key, true)}
          >
            <X className="size-4" aria-hidden />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="top" sideOffset={4}>
          {dismiss}
        </TooltipContent>
      </Tooltip>
    </div>
  )
}
