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
import { openInWorkbenchBrowser, runInWorkbenchTerminal } from '../workbench/workbench-terminals'
import { useDevopsInspection } from './use-devops-inspection'
import { useDevopsSandbox, type DevopsSandbox } from './use-devops-sandbox'
import { DevopsContextBar } from './DevopsContextBar'
import { rankDevopsActions, type RankedDevopsAction } from '../../../../shared/fork-devops-actions'
import { stackOfWorkspaceFile, type DevopsStack } from '../../../../shared/fork-devops-stacks'
import { devopsCommandLine, type DevopsInspection } from '../../../../shared/fork-devops-inspection'
import { FLOCI_DASHBOARD_URL } from '../../../../shared/fork-devops-sandbox'

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

function run(
  worktreeId: string,
  inspection: DevopsInspection,
  sandbox: DevopsSandbox,
  item: RankedDevopsAction
): void {
  runInWorkbenchTerminal(
    worktreeId,
    devopsCommandLine(inspection.tools[item.action.tool], item.command, inspection.shell),
    sandbox.state.awsEnv
  )
}

function SandboxItem({
  label,
  description,
  disabled,
  onSelect
}: {
  label: string
  description: string
  disabled?: boolean
  onSelect: () => void
}): React.JSX.Element {
  return (
    <DropdownMenuItem disabled={disabled} onSelect={onSelect}>
      <div className="flex min-w-0 flex-col">
        <span>{label}</span>
        <span className="truncate text-xs text-muted-foreground">{description}</span>
      </div>
    </DropdownMenuItem>
  )
}

/** F4: start/stop local AWS (Floci) and a local cluster (vind) for this workspace. */
function SandboxSection({
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
  return (
    <>
      <DropdownMenuLabel>
        {translate('components.devops.sandbox.title', 'Local sandbox (free, no cloud account)')}
      </DropdownMenuLabel>
      {offersAws && !state.awsEnv ? (
        <SandboxItem
          label={translate('components.devops.sandbox.awsStart', 'Start local AWS (Floci)')}
          description={translate(
            'components.devops.sandbox.awsStartHint',
            'New terminals and chats here then talk to the emulator, not your account'
          )}
          disabled={busy !== null}
          onSelect={() => sandbox.run('aws', 'start')}
        />
      ) : null}
      {state.awsEnv ? (
        <>
          <SandboxItem
            label={translate('components.devops.sandbox.awsDashboard', 'Open AWS dashboard')}
            description={FLOCI_DASHBOARD_URL}
            onSelect={() => openInWorkbenchBrowser(worktreeId, FLOCI_DASHBOARD_URL, 'Floci')}
          />
          <SandboxItem
            label={translate('components.devops.sandbox.awsStop', 'Stop local AWS')}
            description={translate(
              'components.devops.sandbox.awsStopHint',
              'New terminals and chats use your real AWS settings again'
            )}
            disabled={busy !== null}
            onSelect={() => sandbox.run('aws', 'stop')}
          />
        </>
      ) : null}
      {offersCluster && !state.cluster ? (
        <SandboxItem
          label={translate('components.devops.sandbox.clusterStart', 'Start local cluster (vind)')}
          description={translate(
            'components.devops.sandbox.clusterStartHint',
            'Kubernetes in a container; kubectl switches to it'
          )}
          disabled={busy !== null}
          onSelect={() => sandbox.run('cluster', 'start')}
        />
      ) : null}
      {state.cluster ? (
        <>
          <SandboxItem
            label={
              state.cluster.paused
                ? translate('components.devops.sandbox.clusterWake', 'Wake local cluster')
                : translate('components.devops.sandbox.clusterSleep', 'Sleep local cluster')
            }
            description={state.cluster.context}
            disabled={busy !== null}
            onSelect={() => sandbox.run('cluster', state.cluster?.paused ? 'resume' : 'pause')}
          />
          <SandboxItem
            label={translate('components.devops.sandbox.clusterDelete', 'Delete local cluster')}
            description={state.cluster.name}
            disabled={busy !== null}
            onSelect={() => sandbox.run('cluster', 'stop')}
          />
        </>
      ) : null}
    </>
  )
}

/** F1: the actions that fit this workspace and the open file, one click each, in a workbench terminal. */
export function DevopsToolbelt({ worktreeId }: { worktreeId: string }): React.JSX.Element | null {
  const inspection = useDevopsInspection(worktreeId)
  const editor = useEditorContextEntry(worktreeId)
  const sandbox = useDevopsSandbox(worktreeId)
  if (!inspection || inspection.findings.length === 0) {
    return null
  }
  const has = (...stacks: DevopsStack[]) =>
    inspection.findings.some((finding) => stacks.includes(finding.stack))
  const offersAws = has('aws', 'terraform')
  const offersCluster = has('kubernetes', 'helm', 'argocd')
  const activeFile = editor
    ? { path: editor.file, stack: stackOfWorkspaceFile(editor.file, inspection.findings) }
    : undefined
  const ranked = rankDevopsActions({ findings: inspection.findings, activeFile })
  if (ranked.length === 0 && !offersAws && !offersCluster) {
    return null
  }
  const top = ranked.find((item) => !missingHint(inspection, item))
  const groups = [...new Set(ranked.map((item) => item.action.stack))]
  const menuLabel = translate('components.devops.toolbelt.menu', 'DevOps')
  return (
    <div className="ml-1 flex items-center gap-0.5" data-devops-toolbelt="">
      <DevopsContextBar
        worktreeId={worktreeId}
        show={{ kube: offersCluster, aws: offersAws, terraform: has('terraform') }}
        terraformDir={
          inspection.findings.find((finding) => finding.stack === 'terraform')?.dirs[0] ?? null
        }
        refreshKey={JSON.stringify(sandbox.state)}
      />
      {top ? (
        <Button
          type="button"
          variant="ghost"
          size="xs"
          title={`${top.action.description}\n${top.command}`}
          onClick={() => run(worktreeId, inspection, sandbox, top)}
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
            {offersAws || offersCluster ? (
              <SandboxSection
                worktreeId={worktreeId}
                sandbox={sandbox}
                offersAws={offersAws}
                offersCluster={offersCluster}
              />
            ) : null}
            {groups.map((stack, index) => (
              <div key={stack}>
                {index > 0 || offersAws || offersCluster ? <DropdownMenuSeparator /> : null}
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
                        onSelect={() => run(worktreeId, inspection, sandbox, item)}
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
