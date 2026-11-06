import { translate } from '@/i18n/i18n'
import { useEditorContextEntry } from '../editor-context/editor-context-store'
import { runInWorkbenchTerminal } from '../workbench/workbench-terminals'
import {
  ActionsCard,
  ContextCard,
  InfraCard,
  ReadinessCard,
  SandboxCard,
  STACK_LABELS
} from './InfraHomeCards'
import { InfraClusterCard } from './InfraClusterCard'
import { InfraCiCard } from './InfraCiCard'
import { InfraLocalRuns } from './InfraLocalRuns'
import { InfraProjectCard } from './InfraProjectCard'
import { InfraSection } from './InfraSection'
import type { DevopsSandbox } from './use-devops-sandbox'
import type { useDevopsProject } from './use-devops-project'
import type { DevopsContext } from '../../../../shared/fork-devops-context'
import type { PathStage } from '../../../../shared/fork-devops-path'
import { rankDevopsActions } from '../../../../shared/fork-devops-actions'
import { devopsCommandLine, type DevopsInspection } from '../../../../shared/fork-devops-inspection'
import {
  stackOfWorkspaceFile,
  type DevopsStack,
  type DevopsStackFinding
} from '../../../../shared/fork-devops-stacks'

/** Tools & settings: every Infra card, loaded only while this view is open. */
export function InfraTools({
  worktreeId,
  findings,
  inspection,
  sandbox,
  context,
  project,
  stages,
  deploy,
  harden,
  cloud,
  observe,
  playground
}: {
  worktreeId: string
  findings: DevopsStackFinding[]
  inspection: DevopsInspection | null
  sandbox: DevopsSandbox
  context: DevopsContext
  project: ReturnType<typeof useDevopsProject>
  stages: PathStage[]
  deploy: React.ReactNode
  harden: React.ReactNode
  cloud: React.ReactNode
  observe: React.ReactNode
  playground: React.ReactNode
}): React.JSX.Element {
  const editor = useEditorContextEntry(worktreeId)
  const has = (...stacks: DevopsStack[]): boolean =>
    findings.some((finding) => stacks.includes(finding.stack))
  const offersAws = has('aws', 'terraform')
  const offersCluster = has('kubernetes', 'helm', 'argocd')
  const activeFile = editor
    ? { path: editor.file, stack: stackOfWorkspaceFile(editor.file, findings) }
    : undefined
  const ranked = rankDevopsActions({ findings, activeFile })
  const whoAmI = ranked.find((item) => item.action.id === 'aws.whoami')
  const next = stages.find((stage) => stage.state === 'next')?.id
  return (
    <div data-infra-tools="">
      <header className="mb-3 flex flex-wrap items-center gap-1">
        {findings.map((finding) => (
          <span
            key={finding.stack}
            className="rounded-md border border-border px-1.5 py-0.5 text-xs text-muted-foreground"
            title={finding.evidence.join('\n')}
          >
            {STACK_LABELS[finding.stack]}
          </span>
        ))}
        {inspection && findings.length === 0 ? (
          <span className="text-xs text-muted-foreground">
            {translate('components.devops.home.noStacks', 'No infrastructure code found yet')}
          </span>
        ) : null}
      </header>
      {project ? <InfraProjectCard project={project} /> : null}
      <InfraSection
        id="infra-section-deploy"
        title={translate('components.devops.section.deploy', 'Deploy · local cluster and GitOps')}
        defaultOpen={next === 'app' || next === 'gitops'}
      >
        {deploy}
      </InfraSection>
      <InfraSection
        id="infra-section-harden"
        title={translate('components.devops.section.harden', 'Harden · security findings')}
        defaultOpen={next === 'harden'}
      >
        {harden}
      </InfraSection>
      <InfraSection
        id="infra-section-cloud"
        title={translate('components.devops.section.cloud', 'Cloud · EKS, plan, cost')}
        defaultOpen={next === 'cloud' || next === 'ship'}
      >
        {cloud}
      </InfraSection>
      <InfraSection
        id="infra-section-observe"
        title={translate(
          'components.devops.section.observe',
          'Observe · environments, metrics, incidents, runbooks'
        )}
        defaultOpen={next === undefined}
      >
        {observe}
      </InfraSection>
      {/* Clusters, demos, machines and scans: loaded for the command deck, never shown. */}
      <div hidden data-infra-playground="">
        {playground}
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
            {has('ci') ? <InfraCiCard /> : null}
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
