import { CheckCircle2, CircleAlert, Cloud, Layers, Play, Ship, Wrench } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import { openInWorkbenchBrowser, runInWorkbenchTerminal } from '../workbench/workbench-terminals'
import type { DevopsSandbox } from './use-devops-sandbox'
import { TONE_CLASS, toneTitle } from './DevopsContextBar'
import type { DevopsContext, DevopsContextTone } from '../../../../shared/fork-devops-context'
import {
  MISE_TOOL_SPECS,
  devopsCommandLine,
  type DevopsInspection
} from '../../../../shared/fork-devops-inspection'
import type { RankedDevopsAction } from '../../../../shared/fork-devops-actions'
import { FLOCI_DASHBOARD_URL } from '../../../../shared/fork-devops-sandbox'
import type { DevopsStack } from '../../../../shared/fork-devops-stacks'

export const STACK_LABELS: Record<DevopsStack, string> = {
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

export function InfraCard({
  title,
  hint,
  children,
  className
}: {
  title: string
  hint?: string
  children: React.ReactNode
  className?: string
}): React.JSX.Element {
  return (
    <section className={cn('rounded-lg border border-border bg-card p-4', className)}>
      <header className="mb-3">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        {hint ? <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p> : null}
      </header>
      {children}
    </section>
  )
}

function ContextRow({
  icon: Icon,
  label,
  value,
  tone
}: {
  icon: typeof Cloud
  label: string
  value: string
  tone: DevopsContextTone
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-3 py-1.5" title={toneTitle(tone)}>
      <Icon className={cn('size-4 shrink-0', TONE_CLASS[tone])} aria-hidden />
      <span className="w-24 shrink-0 text-xs text-muted-foreground">{label}</span>
      <span className={cn('min-w-0 truncate font-mono text-sm', TONE_CLASS[tone])}>{value}</span>
      <span className={cn('ml-auto shrink-0 text-xs', TONE_CLASS[tone])}>
        {tone === 'local'
          ? translate('components.devops.home.local', 'local')
          : tone === 'prod'
            ? translate('components.devops.home.prod', 'PRODUCTION')
            : translate('components.devops.home.real', 'real')}
      </span>
    </div>
  )
}

/** "Where am I pointed?" — the first question before running anything. */
export function ContextCard({
  context,
  show,
  onWhoAmI
}: {
  context: DevopsContext
  show: { kube: boolean; aws: boolean; terraform: boolean }
  onWhoAmI: (() => void) | null
}): React.JSX.Element {
  const { kube, aws, terraform } = context
  const none = translate('components.devops.home.none', 'not set')
  return (
    <InfraCard
      title={translate('components.devops.home.context', 'Where you are pointed')}
      hint={translate(
        'components.devops.home.contextHint',
        'Commands from this workspace, yours and Claude’s, land here'
      )}
    >
      {show.kube ? (
        <ContextRow
          icon={Ship}
          label="Kubernetes"
          value={
            kube ? (kube.namespace ? `${kube.context} / ${kube.namespace}` : kube.context) : none
          }
          tone={kube?.tone ?? 'normal'}
        />
      ) : null}
      {show.aws ? (
        <ContextRow
          icon={Cloud}
          label="AWS"
          value={
            aws
              ? `${aws.tone === 'local' ? 'floci (local)' : aws.profile}${aws.region ? ` · ${aws.region}` : ''}`
              : none
          }
          tone={aws?.tone ?? 'normal'}
        />
      ) : null}
      {show.terraform ? (
        <ContextRow
          icon={Layers}
          label="Terraform"
          value={
            terraform?.workspace ?? translate('components.devops.home.noInit', 'not initialised')
          }
          tone={terraform?.tone ?? 'normal'}
        />
      ) : null}
      {onWhoAmI ? (
        <Button type="button" variant="outline" size="xs" className="mt-2" onClick={onWhoAmI}>
          <Cloud aria-hidden />
          {translate('components.devops.home.whoami', 'Who am I in AWS?')}
        </Button>
      ) : null}
    </InfraCard>
  )
}

/** "Can I even work here?" — every CLI the repo needs, with a one-click fix. */
export function ReadinessCard({
  worktreeId,
  inspection
}: {
  worktreeId: string
  inspection: DevopsInspection
}): React.JSX.Element {
  const tools = Object.values(inspection.tools)
  return (
    <InfraCard
      title={translate('components.devops.home.readiness', 'Readiness')}
      hint={
        inspection.environment === 'mise'
          ? translate(
              'components.devops.home.readinessMise',
              'Tools come from this repo’s mise.toml, never the machine'
            )
          : translate('components.devops.home.readinessPath', 'Tools come from your PATH')
      }
    >
      {tools.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {translate('components.devops.home.noTools', 'Nothing to check yet.')}
        </p>
      ) : (
        <ul className="space-y-1.5">
          {tools.map((status) => (
            <li key={status.tool} className="flex items-center gap-2 text-sm">
              {status.available ? (
                <CheckCircle2 className="size-4 shrink-0 text-status-success" aria-hidden />
              ) : (
                <CircleAlert className="size-4 shrink-0 text-destructive" aria-hidden />
              )}
              <span className="font-mono">{status.tool}</span>
              <span className="min-w-0 truncate text-xs text-muted-foreground">
                {status.available
                  ? status.runner === 'mise'
                    ? translate('components.devops.home.viaMise', 'pinned in mise.toml')
                    : translate('components.devops.home.viaPath', 'on PATH')
                  : status.hint}
              </span>
              {!status.available &&
              inspection.environment === 'mise' &&
              MISE_TOOL_SPECS[status.tool] ? (
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  className="ml-auto shrink-0"
                  title={`mise use ${MISE_TOOL_SPECS[status.tool]}`}
                  onClick={() =>
                    runInWorkbenchTerminal(worktreeId, `mise use ${MISE_TOOL_SPECS[status.tool]}`)
                  }
                >
                  <Wrench aria-hidden />
                  {translate('components.devops.home.pin', 'Add to mise.toml')}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </InfraCard>
  )
}

function Tile({
  title,
  status,
  running,
  children
}: {
  title: string
  status: string
  running: boolean
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="rounded-md border border-border p-3">
      <div className="flex items-center gap-2">
        <span
          className={cn(
            'size-2 rounded-full',
            running ? 'bg-status-success' : 'bg-muted-foreground/40'
          )}
          aria-hidden
        />
        <span className="text-sm font-medium">{title}</span>
        <span className="ml-auto text-xs text-muted-foreground">{status}</span>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">{children}</div>
    </div>
  )
}

/** "Where can I try this safely?" — free local AWS and Kubernetes, one click each. */
export function SandboxCard({
  worktreeId,
  sandbox,
  offersAws,
  offersCluster
}: {
  worktreeId: string
  sandbox: DevopsSandbox
  offersAws: boolean
  offersCluster: boolean
}): React.JSX.Element {
  const { state, busy } = sandbox
  const off = translate('components.devops.home.stopped', 'stopped')
  const button = (label: string, onClick: () => void, disabled = busy !== null) => (
    <Button type="button" variant="outline" size="xs" disabled={disabled} onClick={onClick}>
      {label}
    </Button>
  )
  return (
    <InfraCard
      title={translate('components.devops.home.sandbox', 'Local sandbox')}
      hint={translate(
        'components.devops.home.sandboxHint',
        'Practise for free: nothing here touches a real account. Claude may apply and destroy freely.'
      )}
    >
      <div className="grid gap-2 sm:grid-cols-2">
        {offersAws ? (
          <Tile
            title="AWS · Floci"
            running={Boolean(state.awsEnv)}
            status={state.awsEnv ? (state.awsEnv.AWS_DEFAULT_REGION ?? 'running') : off}
          >
            {state.awsEnv ? (
              <>
                {button(translate('components.devops.home.dashboard', 'Dashboard'), () =>
                  openInWorkbenchBrowser(worktreeId, FLOCI_DASHBOARD_URL, 'Floci')
                )}
                {button(translate('components.devops.home.stop', 'Stop'), () =>
                  sandbox.run('aws', 'stop')
                )}
              </>
            ) : (
              button(translate('components.devops.home.start', 'Start'), () =>
                sandbox.run('aws', 'start')
              )
            )}
          </Tile>
        ) : null}
        {offersCluster ? (
          <Tile
            title="Kubernetes · vind"
            running={Boolean(state.cluster && !state.cluster.paused)}
            status={state.cluster ? (state.cluster.paused ? 'asleep' : state.cluster.name) : off}
          >
            {state.cluster ? (
              <>
                {button(
                  state.cluster.paused
                    ? translate('components.devops.home.wake', 'Wake')
                    : translate('components.devops.home.sleep', 'Sleep'),
                  () => sandbox.run('cluster', state.cluster?.paused ? 'resume' : 'pause')
                )}
                {button(translate('components.devops.home.delete', 'Delete'), () =>
                  sandbox.run('cluster', 'stop')
                )}
              </>
            ) : (
              button(translate('components.devops.home.start', 'Start'), () =>
                sandbox.run('cluster', 'start')
              )
            )}
          </Tile>
        ) : null}
      </div>
    </InfraCard>
  )
}

/** "What do I usually run here?" — every Toolbelt action, labelled, grouped by stack. */
export function ActionsCard({
  worktreeId,
  inspection,
  sandbox,
  ranked
}: {
  worktreeId: string
  inspection: DevopsInspection
  sandbox: DevopsSandbox
  ranked: readonly RankedDevopsAction[]
}): React.JSX.Element {
  const stacks = [...new Set(ranked.map((item) => item.action.stack))]
  return (
    <InfraCard
      title={translate('components.devops.home.actions', 'Actions')}
      hint={translate(
        'components.devops.home.actionsHint',
        'Read and plan only; each runs in a terminal beside you'
      )}
    >
      <div className="space-y-3">
        {stacks.map((stack) => (
          <div key={stack}>
            <div className="mb-1.5 text-xs font-medium text-muted-foreground">
              {STACK_LABELS[stack]}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {ranked
                .filter((item) => item.action.stack === stack)
                .map((item) => {
                  const status = inspection.tools[item.action.tool]
                  const missing = status && !status.available ? status.hint : null
                  return (
                    <Button
                      key={item.action.id}
                      type="button"
                      variant="outline"
                      size="xs"
                      disabled={missing !== null}
                      title={missing ?? `${item.action.description}\n${item.command}`}
                      onClick={() =>
                        runInWorkbenchTerminal(
                          worktreeId,
                          devopsCommandLine(status, item.command, inspection.shell),
                          sandbox.state.awsEnv
                        )
                      }
                    >
                      <Play aria-hidden />
                      {item.action.label}
                    </Button>
                  )
                })}
            </div>
          </div>
        ))}
      </div>
    </InfraCard>
  )
}
