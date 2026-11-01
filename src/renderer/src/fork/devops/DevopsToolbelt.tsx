import { ChevronDown, Play, Wrench } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { translate } from '@/i18n/i18n'
import { useEditorContextEntry } from '../editor-context/editor-context-store'
import { runInWorkbenchTerminal } from '../workbench/workbench-terminals'
import { useDevopsInspection } from './use-devops-inspection'
import { rankDevopsActions, type RankedDevopsAction } from '../../../../shared/fork-devops-actions'
import { stackOfWorkspaceFile, type DevopsStack } from '../../../../shared/fork-devops-stacks'
import { devopsCommandLine, type DevopsInspection } from '../../../../shared/fork-devops-inspection'

const STACK_LABELS: Record<DevopsStack, string> = {
  terraform: 'Terraform',
  kubernetes: 'Kubernetes',
  helm: 'Helm',
  argocd: 'Argo CD',
  aws: 'AWS',
  containers: 'Containers',
  ci: 'CI',
  ansible: 'Ansible',
  secrets: 'Secrets'
}

function missingHint(inspection: DevopsInspection, item: RankedDevopsAction): string | null {
  const status = inspection.tools[item.action.tool]
  return status && !status.available ? status.hint : null
}

function run(worktreeId: string, inspection: DevopsInspection, item: RankedDevopsAction): void {
  runInWorkbenchTerminal(
    worktreeId,
    devopsCommandLine(inspection.tools[item.action.tool], item.command, inspection.shell)
  )
}

/** F1: the actions that fit this workspace and the open file, one click each, in a workbench terminal. */
export function DevopsToolbelt({ worktreeId }: { worktreeId: string }): React.JSX.Element | null {
  const inspection = useDevopsInspection(worktreeId)
  const editor = useEditorContextEntry(worktreeId)
  if (!inspection || inspection.findings.length === 0) {
    return null
  }
  const activeFile = editor
    ? { path: editor.file, stack: stackOfWorkspaceFile(editor.file, inspection.findings) }
    : undefined
  const ranked = rankDevopsActions({ findings: inspection.findings, activeFile })
  if (ranked.length === 0) {
    return null
  }
  const top = ranked.find((item) => !missingHint(inspection, item))
  const groups = [...new Set(ranked.map((item) => item.action.stack))]
  const menuLabel = translate('components.devops.toolbelt.menu', 'DevOps')
  return (
    <div className="ml-1 flex items-center gap-0.5" data-devops-toolbelt="">
      {top ? (
        <Button
          type="button"
          variant="ghost"
          size="xs"
          title={`${top.action.description}\n${top.command}`}
          onClick={() => run(worktreeId, inspection, top)}
        >
          <Play aria-hidden />
          {`${STACK_LABELS[top.action.stack]} ${top.action.label}`}
        </Button>
      ) : null}
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="ghost" size="xs" aria-label={menuLabel}>
            <Wrench aria-hidden />
            {menuLabel}
            <ChevronDown aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-72">
          <div className="scrollbar-sleek max-h-96 overflow-y-auto">
            {groups.map((stack, index) => (
              <div key={stack}>
                {index > 0 ? <DropdownMenuSeparator /> : null}
                <DropdownMenuLabel>{STACK_LABELS[stack]}</DropdownMenuLabel>
                {ranked
                  .filter((item) => item.action.stack === stack)
                  .map((item) => {
                    const hint = missingHint(inspection, item)
                    return (
                      <DropdownMenuItem
                        key={item.action.id}
                        disabled={hint !== null}
                        title={hint ?? item.command}
                        onSelect={() => run(worktreeId, inspection, item)}
                      >
                        <div className="flex min-w-0 flex-col">
                          <span>{item.action.label}</span>
                          <span className="truncate text-xs text-muted-foreground">
                            {hint ?? item.action.description}
                          </span>
                        </div>
                      </DropdownMenuItem>
                    )
                  })}
              </div>
            ))}
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
