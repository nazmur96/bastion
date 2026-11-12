import { createPortal } from 'react-dom'
import { RefreshCw, Terminal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { useSidebarHostScopeOptions } from '@/components/sidebar/use-sidebar-host-scope-options'
import { indexExecutionHostsById } from '../../../../shared/managed-orcad-execution-host'
import { runInWorkbenchTerminal } from '../workbench/workbench-terminals'
import { rankDevopsActions } from '../../../../shared/fork-devops-actions'
import type { DevopsInspection } from '../../../../shared/fork-devops-inspection'
import { ActionsCard, InfraCard, STACK_LABELS } from './InfraHomeCards'
import { InfraViewHeader } from './InfraHomeHeader'
import { setInfraView, useInfraOverlayTarget, useInfraView } from './infra-home-store'
import { useRuntimeDevopsStacks } from './use-runtime-devops-stacks'
import type { RuntimeDevopsStacks } from './runtime-devops-stacks'

/** Tools & settings for a project whose files live on another host; draws into the workbench overlay. */
export function RemoteInfraOverlay({
  worktreeId
}: {
  worktreeId: string
}): React.JSX.Element | null {
  const view = useInfraView(worktreeId)
  const overlay = useInfraOverlayTarget(worktreeId)
  return overlay && view
    ? createPortal(
        <div className="mx-auto max-w-5xl p-5" data-infra-view="tools">
          <InfraViewHeader view="tools" onClose={() => setInfraView(worktreeId, null)} />
          <RemoteInfraTools worktreeId={worktreeId} />
        </div>,
        overlay
      )
    : null
}

// Only catalog tool names reach this line, so none need quoting.
function toolCheckCommand(tools: readonly string[], usesMise: boolean): string {
  const probe = usesMise ? 'mise which "$t" 2>/dev/null || command -v "$t"' : 'command -v "$t"'
  return `for t in ${tools.join(' ')}; do printf '%s: ' "$t"; ${probe} || echo 'not found'; done`
}

function remoteInspection(data: RuntimeDevopsStacks, tools: readonly string[]): DevopsInspection {
  return {
    findings: data.findings,
    environment: data.usesMise ? 'mise' : 'path',
    shell: 'posix',
    // The repo declares mise as its tool owner; availability itself is not probed remotely.
    tools: data.usesMise
      ? Object.fromEntries(
          tools.map((tool) => [
            tool,
            { tool, available: true, runner: 'mise', prefix: 'mise exec -- ' } as const
          ])
        )
      : {}
  }
}

function RemoteInfraTools({ worktreeId }: { worktreeId: string }): React.JSX.Element {
  const { hostId, result, refresh } = useRuntimeDevopsStacks(worktreeId)
  const { hostOptions } = useSidebarHostScopeOptions()
  const hostLabel = indexExecutionHostsById(hostOptions).get(hostId)?.label ?? hostId
  const data = result && 'data' in result ? result.data : null
  const ranked = data ? rankDevopsActions({ findings: data.findings }) : []
  const tools = [...new Set(ranked.map((item) => item.action.tool))]
  return (
    <div className="space-y-4">
      <InfraCard
        title={translate('components.devops.remote.title', 'Runs on {{host}}', { host: hostLabel })}
        hint={translate(
          'components.devops.remote.hint',
          'Stacks are read through this project’s owner. Tool availability, cloud and cluster context, plans and scans are not checked on this runtime; actions run visibly in this project’s terminal.'
        )}
      >
        <div className="flex flex-wrap gap-1.5">
          <Button type="button" variant="outline" size="xs" onClick={refresh}>
            <RefreshCw aria-hidden />
            {translate('components.devops.remote.refresh', 'Read stacks again')}
          </Button>
          {tools.length > 0 ? (
            <Button
              type="button"
              variant="outline"
              size="xs"
              title={toolCheckCommand(tools, data?.usesMise ?? false)}
              onClick={() =>
                runInWorkbenchTerminal(worktreeId, toolCheckCommand(tools, data?.usesMise ?? false))
              }
            >
              <Terminal aria-hidden />
              {translate('components.devops.remote.checkTools', 'Check tools in terminal')}
            </Button>
          ) : null}
        </div>
      </InfraCard>
      {result === null ? (
        <p className="text-xs text-muted-foreground" role="status">
          {translate('components.devops.remote.reading', 'Reading project stacks…')}
        </p>
      ) : 'error' in result ? (
        <p className="text-xs text-destructive" role="alert">
          {result.error}
        </p>
      ) : result.data.findings.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {translate(
            'workspaceDesktop.noStacks',
            'No supported infrastructure stacks detected in the selected project.'
          )}
        </p>
      ) : (
        <>
          <InfraCard title={translate('components.devops.remote.stacks', 'Detected stacks')}>
            <ul className="space-y-1 text-xs">
              {result.data.findings.map((finding) => (
                <li key={finding.stack}>
                  <span className="font-medium">{STACK_LABELS[finding.stack]}</span>{' '}
                  <span className="font-mono text-muted-foreground break-all">
                    {finding.dirs.map((dir) => dir || '.').join(', ')}
                  </span>
                </li>
              ))}
            </ul>
          </InfraCard>
          {ranked.length > 0 ? (
            <ActionsCard
              worktreeId={worktreeId}
              inspection={remoteInspection(result.data, tools)}
              ranked={ranked}
            />
          ) : null}
        </>
      )}
    </div>
  )
}
