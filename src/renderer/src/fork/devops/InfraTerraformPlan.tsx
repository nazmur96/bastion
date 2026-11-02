import { useState } from 'react'
import { GitCompare, Layers, MessageSquare, Play, ShieldAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store'
import { selectKnownWorktreeById } from '@/store/selectors'
import { translate } from '@/i18n/i18n'
import { runInWorkbenchTerminal } from '../workbench/workbench-terminals'
import { draftForClaude } from './ask-claude'
import { InfraCard } from './InfraHomeCards'
import type { DevopsSandbox } from './use-devops-sandbox'
import type { DevopsContext } from '../../../../shared/fork-devops-context'
import { devopsCommandLine, type DevopsInspection } from '../../../../shared/fork-devops-inspection'
import {
  planAsText,
  type PlanAction,
  type TerraformPlanResult
} from '../../../../shared/fork-terraform-plan'

const ACTION_CLASS: Record<PlanAction, string> = {
  create: 'text-status-success',
  update: 'text-status-warning',
  replace: 'text-destructive',
  delete: 'text-destructive',
  read: 'text-muted-foreground'
}

function shellQuote(value: string): string {
  return /^[\w./:\\-]+$/.test(value) ? value : `"${value.replace(/"/g, '\\"')}"`
}

/** A3: what `terraform plan` would do, readable, with Claude's review and a human-only apply. */
export function InfraTerraformPlan({
  worktreeId,
  terraformDir,
  inspection,
  sandbox,
  context
}: {
  worktreeId: string
  terraformDir: string
  inspection: DevopsInspection | null
  sandbox: DevopsSandbox
  context: DevopsContext
}): React.JSX.Element {
  const path = useAppStore((state) => selectKnownWorktreeById(state, worktreeId)?.path)
  const [result, setResult] = useState<TerraformPlanResult | null>(null)
  const [running, setRunning] = useState(false)
  const [armed, setArmed] = useState(false)
  const [drift, setDrift] = useState(false)
  const prod = context.aws?.tone === 'prod' || context.terraform?.tone === 'prod'

  const plan = (refreshOnly: boolean): void => {
    if (!path || running) {
      return
    }
    setRunning(true)
    setArmed(false)
    setDrift(refreshOnly)
    void window.api.aiVault
      .terraformPlan({ workspacePath: path, dir: terraformDir, refreshOnly })
      .then(setResult)
      .finally(() => setRunning(false))
  }

  const summary = result?.ok ? result.summary : null
  // A drift check lists what changed outside Terraform; a plan lists what it would change.
  const shown = summary ? (drift ? summary.drift : summary.resources) : []
  const modules = [...new Set(shown.map((resource) => resource.module))]
  const target =
    context.aws?.tone === 'local'
      ? 'Floci (local)'
      : `${context.aws?.profile ?? 'default'}${context.aws?.region ? ` · ${context.aws.region}` : ''}`

  return (
    <InfraCard
      className="mb-4"
      title={translate('components.devops.plan.title', 'Terraform plan · {{dir}}', {
        dir: terraformDir
      })}
      hint={translate(
        'components.devops.plan.hint',
        'Plan only. Applying is always yours, from a terminal you can see.'
      )}
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Button type="button" size="xs" onClick={() => plan(false)} disabled={running || !path}>
          <Layers aria-hidden />
          {running
            ? translate('components.devops.plan.running', 'Planning…')
            : translate('components.devops.plan.run', 'Plan')}
        </Button>
        <Button
          type="button"
          size="xs"
          variant="outline"
          onClick={() => plan(true)}
          disabled={running || !path}
          title={translate(
            'components.devops.plan.driftHint',
            'terraform plan -refresh-only: what changed outside Terraform'
          )}
        >
          <GitCompare aria-hidden />
          {translate('components.devops.plan.drift', 'Check drift')}
        </Button>
        <span className={cn('text-xs', prod ? 'text-destructive' : 'text-muted-foreground')}>
          {translate('components.devops.plan.target', 'against {{target}}', { target })}
        </span>
      </div>
      {result && !result.ok ? (
        <pre className="scrollbar-sleek max-h-48 overflow-auto whitespace-pre-wrap text-xs text-destructive">
          {result.error}
        </pre>
      ) : null}
      {summary && result?.ok ? (
        <>
          <div className="mb-2 flex flex-wrap gap-3 text-xs">
            {drift ? (
              <span className={shown.length > 0 ? 'text-status-warning' : 'text-status-success'}>
                {translate(
                  'components.devops.plan.driftCount',
                  '{{count}} drifted outside Terraform',
                  {
                    count: shown.length
                  }
                )}
              </span>
            ) : null}
            {(drift ? [] : (['create', 'update', 'replace', 'delete'] as const)).map((action) => (
              <span key={action} className={ACTION_CLASS[action]}>
                {summary.counts[action]} {action}
              </span>
            ))}
            {summary.outputs.length > 0 ? (
              <span className="text-muted-foreground">
                {translate('components.devops.plan.outputs', 'outputs: {{names}}', {
                  names: summary.outputs.join(', ')
                })}
              </span>
            ) : null}
          </div>
          {shown.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              {translate(
                'components.devops.plan.noChanges',
                'No changes. Infrastructure matches the code.'
              )}
            </p>
          ) : (
            <div className="scrollbar-sleek max-h-80 space-y-2 overflow-y-auto">
              {modules.map((module) => (
                <div key={module}>
                  <div className="mb-1 font-mono text-[11px] text-muted-foreground">{module}</div>
                  {shown
                    .filter((resource) => resource.module === module)
                    .map((resource) => (
                      <details
                        key={resource.address}
                        className="rounded-md border border-border px-2 py-1"
                      >
                        <summary className="flex cursor-pointer items-center gap-2 text-sm">
                          <span
                            className={cn(
                              'w-14 shrink-0 text-xs font-medium',
                              ACTION_CLASS[resource.action]
                            )}
                          >
                            {resource.action}
                          </span>
                          <span className="min-w-0 truncate font-mono text-xs">
                            {resource.address}
                          </span>
                        </summary>
                        {resource.changes.length > 0 ? (
                          <ul className="mt-1 space-y-0.5 pl-16 font-mono text-[11px]">
                            {resource.changes.map((change) => (
                              <li key={change.path} className="truncate">
                                <span className="text-muted-foreground">{change.path}: </span>
                                <span className="text-destructive">{change.before}</span>
                                {' → '}
                                <span className="text-status-success">{change.after}</span>
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </details>
                    ))}
                </div>
              ))}
            </div>
          )}
          {shown.length > 0 ? (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="xs"
                variant="outline"
                onClick={() =>
                  draftForClaude(
                    worktreeId,
                    drift
                      ? `Terraform in ${terraformDir} (${target}) found these changes made outside Terraform. For each, say what likely changed it, whether it is risky, and whether to adopt it into the code or revert it. Do not apply anything.\n\n${planAsText({ ...summary, resources: summary.drift })}`
                      : `Review this Terraform plan for ${terraformDir} against ${target}. List the risky changes first (deletes, replaces, data loss, downtime, IAM and network exposure, cost), then anything I should check before applying. Do not apply anything.\n\n${planAsText(summary)}`
                  )
                }
              >
                <MessageSquare aria-hidden />
                {translate('components.devops.plan.explain', 'Explain with Claude')}
              </Button>
              {drift ? null : (
                <Button
                  type="button"
                  size="xs"
                  variant={armed ? 'destructive' : 'outline'}
                  onBlur={() => setArmed(false)}
                  onClick={() => {
                    if (!armed) {
                      setArmed(true)
                      return
                    }
                    setArmed(false)
                    runInWorkbenchTerminal(
                      worktreeId,
                      devopsCommandLine(
                        inspection?.tools.terraform,
                        `terraform -chdir=${shellQuote(result.dir)} apply ${shellQuote(result.planFile)}`,
                        inspection?.shell
                      ),
                      sandbox.state.awsEnv
                    )
                  }}
                >
                  {prod ? <ShieldAlert aria-hidden /> : <Play aria-hidden />}
                  {armed
                    ? translate(
                        'components.devops.plan.confirm',
                        'Click again to apply to {{target}}',
                        {
                          target
                        }
                      )
                    : translate('components.devops.plan.apply', 'Apply this plan')}
                </Button>
              )}
            </div>
          ) : null}
        </>
      ) : null}
    </InfraCard>
  )
}
