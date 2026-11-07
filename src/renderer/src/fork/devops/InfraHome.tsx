import { useCallback, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { InfraViewHeader } from './InfraHomeHeader'
import { setInfraView, useInfraOverlayTarget, useInfraView } from './infra-home-store'
import { useAppStore } from '@/store'
import { selectKnownWorktreeById } from '@/store/selectors'
import { useDevopsInspection } from './use-devops-inspection'
import { useDevopsSandbox } from './use-devops-sandbox'
import { useDevopsContext } from './use-devops-context'
import { InfraLaunchpad } from './InfraLaunchpad'
import { InfraSystemMap } from './InfraSystemMap'
import { InfraTools } from './InfraTools'
import { useDeckCommands } from './command-deck-store'
import { translate } from '@/i18n/i18n'
import { PathMap } from './PathMap'
import { InfraCommandDeck } from './InfraCommandDeck'
import { useSystemMap } from './use-system-map'
import { InfraTerraformPlan } from './InfraTerraformPlan'
import { InfraArgoDeploy } from './InfraArgoDeploy'
import { InfraLocalDeploy } from './InfraLocalDeploy'
import { HIDDEN_CARDS, InfraPathStepper, scrollToInfraCard } from './InfraPathStepper'
import { InfraCloudCard } from './InfraCloudCard'
import { InfraHardenCard } from './InfraHardenCard'
import { InfraWatchCard } from './InfraWatchCard'
import { InfraEnvironmentsCard } from './InfraEnvironmentsCard'
import { InfraExtras } from './InfraExtras'
import { useTerraformOutputs } from './use-terraform-outputs'
import { eksFromOutputs } from '../../../../shared/fork-terraform-plan'
import { markPath, readPathMarks, type PathMarks } from './path-progress-store'
import { pathStages } from '../../../../shared/fork-devops-path'
import { projectAppName } from '../../../../shared/fork-devops-project'
import { useDevopsProject } from './use-devops-project'
import { devopsCommandLine } from '../../../../shared/fork-devops-inspection'
import type { DevopsStack } from '../../../../shared/fork-devops-stacks'

export function InfraHome({ worktreeId }: { worktreeId: string }): React.JSX.Element {
  const inspection = useDevopsInspection(worktreeId)
  const sandbox = useDevopsSandbox(worktreeId)
  // The repo folder, not the branch a worktree is named after.
  const path = useAppStore((state) => selectKnownWorktreeById(state, worktreeId)?.path)
  const findings = inspection?.findings ?? []
  const has = (...stacks: DevopsStack[]) =>
    findings.some((finding) => stacks.includes(finding.stack))
  const terraformDir = findings.find((finding) => finding.stack === 'terraform')?.dirs[0] ?? null
  const context = useDevopsContext(worktreeId, terraformDir, JSON.stringify(sandbox.state))
  const offersCluster = has('kubernetes', 'helm', 'argocd')
  const [deckOpen, setDeckOpen] = useState(false)
  const view = useInfraView(worktreeId)
  const overlay = useInfraOverlayTarget(worktreeId)
  const showCard = useCallback(
    (card: string) => {
      // The Launchpad is never shown: its step stays on the path and goes to Claude instead.
      if (!card || HIDDEN_CARDS.has(card)) {
        return false
      }
      setInfraView(worktreeId, 'tools')
      // Tools mounts its cards on open; scroll once they are laid out.
      window.setTimeout(() => scrollToInfraCard(card), 120)
      return true
    },
    [worktreeId]
  )
  const project = useDevopsProject(worktreeId)
  const toolsCommand = useMemo(
    () => [
      {
        id: 'infra:tools',
        group: translate('components.devops.deck.path', 'Project path'),
        label: translate('components.devops.home.tools', 'Tools & settings'),
        keywords: ['settings', 'tools', 'cards', 'launchpad', 'scan', 'grafana', 'environments'],
        run: () => setInfraView(worktreeId, 'tools')
      }
    ],
    [worktreeId]
  )
  useDeckCommands('infra-tools', toolsCommand)
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
  const clusterAnswers = cluster.result?.ok === true
  const kubectlPrefix =
    inspection?.tools.kubectl?.available && inspection.tools.kubectl.runner === 'mise'
      ? 'mise exec -- '
      : ''
  const launchpad = (
    <InfraLaunchpad
      worktreeId={worktreeId}
      inspection={inspection}
      sandbox={sandbox}
      context={context}
      terraformDir={terraformDir}
      clusterAnswers={clusterAnswers}
    />
  )
  const localDeploy =
    path && appPath && manifestsPath && appHasImage && (appHasManifests || gitopsRepo) ? (
      <InfraLocalDeploy
        worktreeId={worktreeId}
        workspacePath={path}
        appPath={appPath}
        manifestsPath={manifestsPath}
        inspection={inspection}
        context={context}
        clusterAnswers={clusterAnswers}
        onDeployed={cluster.refresh}
      />
    ) : null
  const argo =
    offersCluster || gitopsRepo ? (
      <InfraArgoDeploy
        gitopsRepo={gitopsRepo}
        onApplication={onApplication}
        worktreeId={worktreeId}
        inspection={inspection}
        context={context}
        clusterAnswers={clusterAnswers}
      />
    ) : null
  const harden = path ? (
    <InfraHardenCard
      worktreeId={worktreeId}
      workspacePath={path}
      onScanned={() => setMarks(markPath(path, 'hardened'))}
    />
  ) : null
  const nextId = stages.find((stage) => stage.state === 'next')?.id
  // Only the card behind the next step is loaded on the path, so its button can run; the
  // rest load when Tools & settings opens.
  const nextCard =
    nextId === 'cluster'
      ? launchpad
      : nextId === 'app'
        ? localDeploy
        : nextId === 'gitops' || nextId === 'ship'
          ? argo
          : nextId === 'harden'
            ? harden
            : null
  const fullMap = (
    <InfraSystemMap
      worktreeId={worktreeId}
      context={context}
      result={cluster.result}
      refresh={cluster.refresh}
      workspacePath={path}
      kubectlPrefix={kubectlPrefix}
    />
  )
  const toolsView = (
    <InfraTools
      worktreeId={worktreeId}
      findings={findings}
      sandbox={sandbox}
      context={context}
      inspection={inspection}
      project={project}
      stages={stages}
      deploy={
        <>
          {localDeploy}
          {argo}
        </>
      }
      harden={harden}
      cloud={
        <>
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
        </>
      }
      observe={
        path ? (
          <>
            {offersCluster || appHasManifests ? (
              <>
                <InfraEnvironmentsCard
                  worktreeId={worktreeId}
                  workspacePath={path}
                  namespace={appNamespace}
                  commandLine={(command) =>
                    devopsCommandLine(inspection?.tools.kubectl, command, inspection?.shell)
                  }
                />
                <InfraWatchCard
                  worktreeId={worktreeId}
                  workspacePath={path}
                  namespace={appNamespace}
                  inspection={inspection}
                  context={context}
                  clusterAnswers={clusterAnswers}
                />
              </>
            ) : null}
            <InfraExtras
              appName={appNamespace}
              map={cluster.result}
              deployed={gitopsDone}
              shipped={shipped}
              worktreeId={worktreeId}
              workspacePath={path}
              context={context}
              clusterAnswers={clusterAnswers}
            />
          </>
        ) : null
      }
      playground={launchpad}
    />
  )
  return (
    <aside className="bx-pathcol" data-infra-home="">
      <InfraCommandDeck worktreeId={worktreeId} open={deckOpen} onOpenChange={setDeckOpen} />
      {path ? (
        <InfraPathStepper
          worktreeId={worktreeId}
          stages={stages}
          members={project?.members ?? []}
          onUnderstood={() => setMarks(markPath(path, 'understood'))}
          onShowCard={showCard}
        />
      ) : null}
      <PathMap
        worktreeId={worktreeId}
        context={context}
        result={cluster.result}
        onOpenFull={() => setInfraView(worktreeId, 'map')}
      />
      <div hidden data-infra-playground="">
        {view === 'tools' ? null : nextCard}
      </div>
      {overlay && view
        ? createPortal(
            <div className="mx-auto max-w-5xl p-5" data-infra-view={view}>
              <InfraViewHeader view={view} onClose={() => setInfraView(worktreeId, null)} />
              {view === 'map' ? fullMap : toolsView}
            </div>,
            overlay
          )
        : null}
    </aside>
  )
}
