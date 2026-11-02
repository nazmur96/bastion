import { useEffect, useRef, useState } from 'react'
import { Command, Server, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAppStore } from '@/store'
import { selectKnownWorktreeById } from '@/store/selectors'
import { translate } from '@/i18n/i18n'
import { useEditorContextEntry } from '../editor-context/editor-context-store'
import { workbenchGroupId, runInWorkbenchTerminal } from '../workbench/workbench-terminals'
import { useDevopsInspection } from './use-devops-inspection'
import { useDevopsSandbox } from './use-devops-sandbox'
import { useDevopsContext } from './use-devops-context'
import { openInfraHomeOnce, setInfraHomeOpen, useInfraHomeOpen } from './infra-home-store'
import {
  ActionsCard,
  ContextCard,
  InfraCard,
  ReadinessCard,
  SandboxCard,
  STACK_LABELS
} from './InfraHomeCards'
import { InfraClusterCard } from './InfraClusterCard'
import { InfraLaunchpad } from './InfraLaunchpad'
import { InfraLocalRuns } from './InfraLocalRuns'
import { InfraSystemMap } from './InfraSystemMap'
import { InfraCommandDeck } from './InfraCommandDeck'
import { rankDevopsActions } from '../../../../shared/fork-devops-actions'
import { devopsCommandLine } from '../../../../shared/fork-devops-inspection'
import { stackOfWorkspaceFile, type DevopsStack } from '../../../../shared/fork-devops-stacks'

function InfraHome({ worktreeId }: { worktreeId: string }): React.JSX.Element {
  const inspection = useDevopsInspection(worktreeId)
  const sandbox = useDevopsSandbox(worktreeId)
  const editor = useEditorContextEntry(worktreeId)
  // The repo folder, not the branch a worktree is named after.
  const name = useAppStore((state) =>
    selectKnownWorktreeById(state, worktreeId)?.path.split(/[\\/]/).findLast(Boolean)
  )
  const findings = inspection?.findings ?? []
  const has = (...stacks: DevopsStack[]) =>
    findings.some((finding) => stacks.includes(finding.stack))
  const terraformDir = findings.find((finding) => finding.stack === 'terraform')?.dirs[0] ?? null
  const context = useDevopsContext(worktreeId, terraformDir, JSON.stringify(sandbox.state))
  const offersAws = has('aws', 'terraform')
  const offersCluster = has('kubernetes', 'helm', 'argocd')
  const activeFile = editor
    ? { path: editor.file, stack: stackOfWorkspaceFile(editor.file, findings) }
    : undefined
  const ranked = rankDevopsActions({ findings, activeFile })
  const whoAmI = ranked.find((item) => item.action.id === 'aws.whoami')
  const [deckOpen, setDeckOpen] = useState(false)
  return (
    <div
      className="scrollbar-sleek absolute inset-0 z-30 overflow-y-auto bg-background"
      data-infra-home=""
    >
      <InfraCommandDeck worktreeId={worktreeId} open={deckOpen} onOpenChange={setDeckOpen} />
      <div className="mx-auto max-w-5xl p-5">
        <header className="mb-4 flex items-start gap-3">
          <Server className="mt-0.5 size-5 text-primary" aria-hidden />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-base font-semibold">
              {translate('components.devops.home.title', 'Infra · {{name}}', { name: name ?? '' })}
            </h1>
            <div className="mt-1.5 flex flex-wrap gap-1">
              {findings.length > 0 ? (
                findings.map((finding) => (
                  <span
                    key={finding.stack}
                    className="rounded-md border border-border px-1.5 py-0.5 text-xs text-muted-foreground"
                    title={finding.evidence.join('\n')}
                  >
                    {STACK_LABELS[finding.stack]}
                  </span>
                ))
              ) : (
                <span className="text-xs text-muted-foreground">
                  {inspection
                    ? translate(
                        'components.devops.home.noStacks',
                        'No infrastructure code found yet'
                      )
                    : translate('components.devops.home.scanning', 'Looking at this repo…')}
                </span>
              )}
            </div>
          </div>
          <Button
            type="button"
            variant="outline"
            size="xs"
            title={translate('components.devops.deck.open', 'Command deck (press :)')}
            onClick={() => setDeckOpen(true)}
          >
            <Command aria-hidden />
            {translate('components.devops.deck.button', 'Commands')}
            <kbd className="text-muted-foreground">:</kbd>
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label={translate('components.devops.home.close', 'Close Infra home')}
            onClick={() => setInfraHomeOpen(worktreeId, false)}
          >
            <X aria-hidden />
          </Button>
        </header>
        <InfraSystemMap
          worktreeId={worktreeId}
          context={context}
          kubectlPrefix={
            inspection?.tools.kubectl?.available && inspection.tools.kubectl.runner === 'mise'
              ? 'mise exec -- '
              : ''
          }
        />
        <InfraLaunchpad
          worktreeId={worktreeId}
          inspection={inspection}
          sandbox={sandbox}
          context={context}
          terraformDir={terraformDir}
        />
        <InfraLocalRuns worktreeId={worktreeId} sandbox={sandbox} />
        {inspection && findings.length === 0 ? (
          <InfraCard
            title={translate('components.devops.home.emptyTitle', 'Start with infrastructure')}
            hint={translate(
              'components.devops.home.emptyHint',
              'Add Terraform, Kubernetes manifests, a Helm chart or CI workflows and this page fills in. Ask Claude to scaffold one.'
            )}
          >
            <p className="text-xs text-muted-foreground">
              {translate(
                'components.devops.home.emptyExample',
                'For example: “Create a Terraform module for an S3 bucket with versioning, and a GitHub Actions workflow that runs terraform plan.”'
              )}
            </p>
          </InfraCard>
        ) : null}
        {inspection && findings.length > 0 ? (
          <div className="grid gap-4 lg:grid-cols-2">
            <ContextCard
              context={context}
              show={{ kube: offersCluster, aws: offersAws, terraform: has('terraform') }}
              onWhoAmI={
                whoAmI
                  ? () =>
                      runInWorkbenchTerminal(
                        worktreeId,
                        devopsCommandLine(inspection.tools.aws, whoAmI.command, inspection.shell),
                        sandbox.state.awsEnv
                      )
                  : null
              }
            />
            <ReadinessCard worktreeId={worktreeId} inspection={inspection} />
            {offersCluster ? (
              <InfraClusterCard
                worktreeId={worktreeId}
                usesMise={inspection.environment === 'mise'}
              />
            ) : null}
            {offersAws || offersCluster ? (
              <SandboxCard
                worktreeId={worktreeId}
                sandbox={sandbox}
                offersAws={offersAws}
                offersCluster={offersCluster}
              />
            ) : null}
            <ActionsCard
              worktreeId={worktreeId}
              inspection={inspection}
              sandbox={sandbox}
              ranked={ranked}
            />
          </div>
        ) : null}
      </div>
    </div>
  )
}

/** Covers the workbench body (terminals keep running beneath) while the Infra section is chosen. */
export function InfraHomeOverlay({
  worktreeId,
  groupId
}: {
  worktreeId: string
  groupId: string
}): React.JSX.Element | null {
  const open = useInfraHomeOpen(worktreeId)
  const isWorkbench = useAppStore(() => workbenchGroupId(worktreeId) === groupId)
  const inspection = useDevopsInspection(worktreeId)
  const activeTabId = useAppStore(
    (state) =>
      state.groupsByWorktree[worktreeId]?.find((group) => group.id === groupId)?.activeTabId
  )
  const seenTab = useRef(activeTabId)
  useEffect(() => {
    // Every workspace starts here once, so the Launchpad is the first thing a new project shows.
    if (isWorkbench && inspection) {
      openInfraHomeOnce(worktreeId)
    }
  }, [inspection, isWorkbench, worktreeId])
  useEffect(() => {
    // Picking a tab in this group means the person wants that tab, not the Infra home.
    if (seenTab.current !== activeTabId) {
      seenTab.current = activeTabId
      if (isWorkbench) {
        setInfraHomeOpen(worktreeId, false)
      }
    }
  }, [activeTabId, isWorkbench, worktreeId])
  return open && isWorkbench ? <InfraHome worktreeId={worktreeId} /> : null
}
