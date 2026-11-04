import { Compass } from 'lucide-react'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import { setInfraHomeOpen, useInfraHomeOpen } from '../devops/infra-home-store'
import { workbenchGroupId } from './workbench-terminals'

/** The workbench's pinned first tab: the project path, as its own place beside files and pages. */
export function WorkbenchSectionBar({
  worktreeId,
  groupId
}: {
  worktreeId: string
  groupId: string
}): React.JSX.Element | null {
  const isWorkbench = useAppStore(() => workbenchGroupId(worktreeId) === groupId)
  const open = useInfraHomeOpen(worktreeId)
  if (!isWorkbench) {
    return null
  }
  return (
    <button
      type="button"
      aria-pressed={open}
      onClick={() => setInfraHomeOpen(worktreeId, true)}
      title={translate(
        'components.workbench.pathHint',
        'Where this project is, its next step and the live system map'
      )}
      className={cn(
        'flex h-full shrink-0 items-center gap-1.5 border-r border-b-2 border-r-border border-b-transparent px-3 text-xs text-muted-foreground hover:text-foreground',
        open && 'border-b-primary bg-background text-foreground'
      )}
      data-workbench-infra=""
    >
      <Compass className="size-3.5 text-primary" aria-hidden />
      <span>{translate('components.workbench.path', 'Project path')}</span>
    </button>
  )
}
