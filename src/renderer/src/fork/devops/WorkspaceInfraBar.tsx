import { Gauge } from 'lucide-react'
import { useAppStore } from '@/store'
import { selectKnownWorktreeById } from '@/store/selectors'
import { translate } from '@/i18n/i18n'
import { DevopsContextBar } from './DevopsContextBar'
import { useProjectCostMeter } from './cost-meter-store'
import { useDevopsProject } from './use-devops-project'
import { useDevopsContext } from './use-devops-context'
import { useDevopsInspection } from './use-devops-inspection'
import { useDevopsSandbox } from './use-devops-sandbox'
import type { DevopsStack } from '../../../../shared/fork-devops-stacks'

function elapsed(hours: number): string {
  const minutes = Math.floor(hours * 60)
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

/** Top of the workspace: which project, where its commands land, and what real cloud is costing. */
function Bar({ worktreeId }: { worktreeId: string }): React.JSX.Element | null {
  const inspection = useDevopsInspection(worktreeId)
  const sandbox = useDevopsSandbox(worktreeId)
  const worktree = useAppStore((state) => selectKnownWorktreeById(state, worktreeId))
  const findings = inspection?.findings ?? []
  const terraformDir = findings.find((finding) => finding.stack === 'terraform')?.dirs[0] ?? null
  const context = useDevopsContext(worktreeId, terraformDir, JSON.stringify(sandbox.state))
  const project = useDevopsProject(worktreeId)
  const meter = useProjectCostMeter([
    ...(worktree ? [worktree.path] : []),
    ...(project?.members.map((member) => member.repo.path) ?? [])
  ])
  if (!worktree) {
    return null
  }
  const has = (...stacks: DevopsStack[]): boolean =>
    findings.some((finding) => stacks.includes(finding.stack))
  const real = (context.kube && context.kube.tone !== 'local') || meter !== null
  const name = worktree.path.split(/[\\/]/).findLast(Boolean) ?? ''
  return (
    <>
      <div
        className="flex h-8 shrink-0 items-center gap-2 border-b border-border bg-card px-3 text-xs"
        data-workspace-infra-bar=""
      >
        <span className="font-semibold text-foreground">{name}</span>
        {worktree.branch ? (
          <span className="text-muted-foreground">
            {worktree.branch.replace(/^refs\/heads\//, '')}
          </span>
        ) : null}
        <DevopsContextBar
          context={context}
          show={{
            // Where kubectl lands matters in every repo, infrastructure code or not.
            kube: true,
            aws: has('aws', 'terraform'),
            terraform: has('terraform')
          }}
        />
        {meter ? (
          <span
            className="flex items-center gap-1 rounded-full border border-status-warning/40 px-2 py-0.5 font-medium text-status-warning"
            title={translate(
              'components.devops.bar.meterHint',
              'Billed cloud infrastructure is running. End the session from the Project path to destroy it.'
            )}
            data-cost-meter=""
          >
            <Gauge className="size-3" aria-hidden />
            {translate('components.devops.bar.meter', 'EKS {{time}} · {{cost}}', {
              time: elapsed(meter.hours),
              cost: meter.spent === null ? '$?' : `$${meter.spent.toFixed(2)}`
            })}
          </span>
        ) : null}
      </div>
      {real ? (
        // Real infrastructure frames the whole window, like the prototype's amber border.
        <div
          className="pointer-events-none fixed inset-0 z-50 border-2 border-status-warning/80"
          aria-hidden
          data-real-frame=""
        />
      ) : null}
    </>
  )
}

export function WorkspaceInfraBar(): React.JSX.Element | null {
  const worktreeId = useAppStore((state) => state.activeWorktreeId)
  return worktreeId ? <Bar key={worktreeId} worktreeId={worktreeId} /> : null
}
