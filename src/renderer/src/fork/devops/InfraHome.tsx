import { useCallback, useState } from 'react'
import { InfraHomeHeader, type InfraHomeView } from './InfraHomeHeader'
import { useAppStore } from '@/store'
import { selectKnownWorktreeById } from '@/store/selectors'
import { translate } from '@/i18n/i18n'
import { useEditorContextEntry } from '../editor-context/editor-context-store'
import { runInWorkbenchTerminal } from '../workbench/workbench-terminals'
import { useDevopsInspection } from './use-devops-inspection'
import { useDevopsSandbox } from './use-devops-sandbox'
import { useDevopsContext } from './use-devops-context'
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
import { useSystemMap } from './use-system-map'
import { InfraTerraformPlan } from './InfraTerraformPlan'
import { InfraCiCard } from './InfraCiCard'
import { InfraArgoDeploy } from './InfraArgoDeploy'
import { InfraProjectCard } from './InfraProjectCard'
import { InfraLocalDeploy } from './InfraLocalDeploy'
import { InfraPathStepper, scrollToInfraCard } from './InfraPathStepper'
import { InfraCloudCard } from './InfraCloudCard'
import { InfraHardenCard } from './InfraHardenCard'
import { InfraWatchCard } from './InfraWatchCard'
import { InfraRunsCard } from './InfraRunsCard'
import { InfraEnvironmentsCard } from './InfraEnvironmentsCard'
import { InfraExtras } from './InfraExtras'
import { InfraSection } from './InfraSection'
import { useTerraformOutputs } from './use-terraform-outputs'
import { eksFromOutputs } from '../../../../shared/fork-terraform-plan'
import { markPath, readPathMarks, type PathMarks } from './path-progress-store'
import { pathStages } from '../../../../shared/fork-devops-path'
import { projectAppName } from '../../../../shared/fork-devops-project'
import { useDevopsProject } from './use-devops-project'
import { rankDevopsActions } from '../../../../shared/fork-devops-actions'
import { devopsCommandLine } from '../../../../shared/fork-devops-inspection'
import { stackOfWorkspaceFile, type DevopsStack } from '../../../../shared/fork-devops-stacks'

export function InfraHome({ worktreeId }: { worktreeId: string }): React.JSX.Element {
  const inspection = useDevopsInspection(worktreeId)
  const sandbox = useDevopsSandbox(worktreeId)
  const editor = useEditorContextEntry(worktreeId)
  // The repo folder, not the branch a worktree is named after.
  const path = useAppStore((state) => selectKnownWorktreeById(state, worktreeId)?.path)
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
  const [view, setView] = useState<InfraHomeView>('path')
  const showCard = useCallback((card: string) => {
    setView('tools')
    // The Tools view shows on the next frame; scroll once it has a layout.
    window.requestAnimationFrame(() => scrollToInfraCard(card))
  }, [])
  const project = useDevopsProject(worktreeId)
  const gitopsRepo = project?.repoFor('gitops') ?? null
  const platformRepo = terraformDir === null ? (project?.repoFor('platform') ?? null) : null
  const appRepo = project?.repoFor('app') ?? null
  const appPath = appRepo?.path ?? path
  const appHasImage = appRepo
    ? appRepo.findings.some((finding) => finding.stack === 'containers')
    : has('containers')
  const appHasManifests = appRepo
    ? appRepo.findings.some((finding) => ['kubernetes', 'helm'].includes(finding.stack))
    : has('kubernetes', 'helm')
  const manifestsPath = appHasManifests ? appPath : (gitopsRepo?.path ?? appPath)
  const [marks, setMarks] = useState<PathMarks>(() =>
    path ? readPathMarks(path) : { understood: false, hardened: false }
  )
  const [gitopsDone, setGitopsDone] = useState(false)
  const [shipped, setShipped] = useState(false)
  const onApplication = useCallback((exists: boolean, local: boolean) => {
    if (local) {
      setGitopsDone(exists)
    } else {
      setShipped(exists)
    }
  }, [])
  const appNamespace = appPath ? projectAppName(appPath.split(/[\\/]/).findLast(Boolean) ?? '') : ''
  const platformDir =
    platformRepo?.findings.find((finding) => finding.stack === 'terraform')?.dirs[0] ?? null
  const planRepo = terraformDir !== null ? path : platformRepo?.path
  const planDir = terraformDir ?? platformDir
  const tfOutputs = useTerraformOutputs(planRepo, planDir)
  const eks = eksFromOutputs(tfOutputs.outputs, context.aws?.region ?? null)
  // EKS applies take 10-20 minutes; re-read the outputs a few times instead of polling forever.
  const afterApply = useCallback(() => {
    for (const minutes of [2, 8, 16, 25]) {
      window.setTimeout(tfOutputs.refresh, minutes * 60_000)
    }
  }, [tfOutputs.refresh])
  const cluster = useSystemMap(context.kube ? path : undefined, context.kube?.context ?? '')
  const stages = pathStages({
    understood: marks.understood,
    localCluster: context.kube?.tone === 'local' && cluster.result?.ok === true,
    appRunning:
      cluster.result?.ok === true &&
      cluster.result.map.nodes.some((node) => node.layer === 2 && node.namespace === appNamespace),
    gitops: gitopsDone,
    hardened: marks.hardened,
    cloud: eks !== null,
    shipped
  })
  return (
    <div
      className="scrollbar-sleek absolute inset-0 z-30 overflow-y-auto bg-background"
      data-infra-home=""
    >
      <InfraCommandDeck worktreeId={worktreeId} open={deckOpen} onOpenChange={setDeckOpen} />
      <div className="mx-auto max-w-5xl p-5">
        <InfraHomeHeader view={view} setView={setView} openDeck={() => setDeckOpen(true)} />
        <div hidden={view !== 'path'}>
          {path ? (
            <InfraPathStepper
              worktreeId={worktreeId}
              stages={stages}
              members={project?.members ?? []}
              onUnderstood={() => setMarks(markPath(path, 'understood'))}
              onShowCard={showCard}
            />
          ) : null}
          <InfraSystemMap
            worktreeId={worktreeId}
            context={context}
            result={cluster.result}
            refresh={cluster.refresh}
            workspacePath={path}
            kubectlPrefix={
              inspection?.tools.kubectl?.available && inspection.tools.kubectl.runner === 'mise'
                ? 'mise exec -- '
                : ''
            }
            footer={<InfraRunsCard />}
          />
        </div>
        {/* Cards stay mounted while hidden: the path stepper runs their actions. */}
        <div hidden={view !== 'tools'} data-infra-tools="">
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
            title={translate(
              'components.devops.section.deploy',
              'Deploy · local cluster and GitOps'
            )}
            defaultOpen={['app', 'gitops'].includes(
              stages.find((stage) => stage.state === 'next')?.id ?? ''
            )}
          >
            {path && appPath && manifestsPath && appHasImage && (appHasManifests || gitopsRepo) ? (
              <InfraLocalDeploy
                worktreeId={worktreeId}
                workspacePath={path}
                appPath={appPath}
                manifestsPath={manifestsPath}
                inspection={inspection}
                context={context}
                clusterAnswers={cluster.result?.ok === true}
                onDeployed={cluster.refresh}
              />
            ) : null}
            {offersCluster || gitopsRepo ? (
              <InfraArgoDeploy
                gitopsRepo={gitopsRepo}
                onApplication={onApplication}
                worktreeId={worktreeId}
                inspection={inspection}
                context={context}
                clusterAnswers={cluster.result?.ok === true}
              />
            ) : null}
          </InfraSection>
          <InfraSection
            id="infra-section-harden"
            title={translate('components.devops.section.harden', 'Harden · security findings')}
            defaultOpen={stages.find((stage) => stage.state === 'next')?.id === 'harden'}
          >
            {path ? (
              <InfraHardenCard
                worktreeId={worktreeId}
                workspacePath={path}
                onScanned={() => setMarks(markPath(path, 'hardened'))}
              />
            ) : null}
          </InfraSection>
          <InfraSection
            id="infra-section-cloud"
            title={translate('components.devops.section.cloud', 'Cloud · EKS, plan, cost')}
            defaultOpen={['cloud', 'ship'].includes(
              stages.find((stage) => stage.state === 'next')?.id ?? ''
            )}
          >
            {path ? (
              <InfraCloudCard
                worktreeId={worktreeId}
                workspacePath={path}
                appName={appNamespace}
                hasTerraform={terraformDir !== null || platformDir !== null}
                platformFolder={project?.repoFor('platform')?.folder ?? 'platform'}
                eks={eks}
                meterRepo={planRepo}
                commandLine={(command) =>
                  devopsCommandLine(inspection?.tools.aws, command, inspection?.shell)
                }
              />
            ) : null}
            {terraformDir !== null || (platformRepo && platformDir !== null) ? (
              <InfraTerraformPlan
                worktreeId={worktreeId}
                terraformDir={terraformDir ?? platformDir ?? '.'}
                platformRepo={terraformDir === null ? platformRepo : null}
                onApplied={afterApply}
                inspection={inspection}
                sandbox={sandbox}
                context={context}
              />
            ) : null}
          </InfraSection>
          <InfraSection
            id="infra-section-observe"
            title={translate(
              'components.devops.section.observe',
              'Observe · environments, metrics, incidents, runbooks'
            )}
            defaultOpen={stages.find((stage) => stage.state === 'next')?.id === undefined}
          >
            {path && (offersCluster || appHasManifests) ? (
              <InfraEnvironmentsCard
                worktreeId={worktreeId}
                workspacePath={path}
                namespace={appNamespace}
                commandLine={(command) =>
                  devopsCommandLine(inspection?.tools.kubectl, command, inspection?.shell)
                }
              />
            ) : null}
            {path && (offersCluster || appHasManifests) ? (
              <InfraWatchCard
                worktreeId={worktreeId}
                workspacePath={path}
                namespace={appNamespace}
                inspection={inspection}
                context={context}
                clusterAnswers={cluster.result?.ok === true}
              />
            ) : null}
            {path ? (
              <InfraExtras
                appName={appNamespace}
                map={cluster.result}
                deployed={gitopsDone}
                shipped={shipped}
                worktreeId={worktreeId}
                workspacePath={path}
                context={context}
                clusterAnswers={cluster.result?.ok === true}
              />
            ) : null}
          </InfraSection>
          <InfraSection
            id="infra-section-playground"
            title={translate(
              'components.devops.section.playground',
              'Playground and tools · clusters, demos, machines, scans'
            )}
            defaultOpen={stages.find((stage) => stage.state === 'next')?.id === 'cluster'}
          >
            <InfraLaunchpad
              worktreeId={worktreeId}
              inspection={inspection}
              sandbox={sandbox}
              context={context}
              terraformDir={terraformDir}
              clusterAnswers={cluster.result?.ok === true}
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
                            devopsCommandLine(
                              inspection.tools.aws,
                              whoAmI.command,
                              inspection.shell
                            ),
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
          </InfraSection>
        </div>
      </div>
    </div>
  )
}
