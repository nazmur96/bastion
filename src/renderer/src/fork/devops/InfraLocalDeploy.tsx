import { useEffect, useState } from 'react'
import { Container, Play } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { runInWorkbenchTerminal } from '../workbench/workbench-terminals'
import { InfraCard } from './InfraHomeCards'
import type { DevopsContext } from '../../../../shared/fork-devops-context'
import { devopsCommandLine, type DevopsInspection } from '../../../../shared/fork-devops-inspection'
import { localDeploySteps, type LocalDeployPlan } from '../../../../shared/fork-devops-local-deploy'

/** Path stage 2: this app's own image and manifests on the local cluster, before any GitOps. */
export function InfraLocalDeploy({
  worktreeId,
  workspacePath,
  appPath,
  manifestsPath,
  inspection,
  context,
  clusterAnswers,
  onDeployed
}: {
  worktreeId: string
  workspacePath: string
  appPath: string
  manifestsPath: string
  inspection: DevopsInspection | null
  context: DevopsContext
  clusterAnswers: boolean
  /** Lets the map refresh once the rollout has had time to start. */
  onDeployed: () => void
}): React.JSX.Element {
  const [plan, setPlan] = useState<LocalDeployPlan | null>(null)
  const kube = context.kube
  const local = kube?.tone === 'local'
  useEffect(() => {
    if (!local || !clusterAnswers) {
      return
    }
    let current = true
    void window.api.aiVault
      .localDeployPlan({ appPath, manifestsPath, clusterPath: workspacePath })
      .then((next) => {
        if (current) {
          setPlan(next)
        }
      })
    return () => {
      current = false
    }
  }, [appPath, manifestsPath, workspacePath, local, clusterAnswers, kube?.context])

  const blocked = !kube
    ? translate('components.devops.local.noCluster', 'Start a local cluster first (kind or k3d).')
    : !local
      ? translate('components.devops.local.notLocal', '{{context}} is not a local cluster.', {
          context: kube.context
        })
      : !clusterAnswers
        ? translate('components.devops.local.down', 'The cluster is not answering.')
        : null

  const run = (): void => {
    if (!plan?.ok) {
      return
    }
    runInWorkbenchTerminal(
      worktreeId,
      devopsCommandLine(
        inspection?.tools.kubectl,
        localDeploySteps(plan).join(' && '),
        inspection?.shell
      )
    )
    window.setTimeout(onDeployed, 20_000)
  }

  return (
    <InfraCard
      className="mb-4"
      title={translate('components.devops.local.title', 'Run this app on the local cluster')}
      hint={translate(
        'components.devops.local.hint',
        'Builds your image, loads it into the cluster and deploys your own manifests. Nothing in the repo changes.'
      )}
    >
      {blocked ? (
        <p className="text-xs text-muted-foreground">{blocked}</p>
      ) : !plan ? (
        <p className="text-xs text-muted-foreground">
          {translate('components.devops.local.reading', 'Reading the app and its manifests…')}
        </p>
      ) : !plan.ok ? (
        <p className="text-xs text-destructive">{plan.error}</p>
      ) : (
        <div className="space-y-2 text-sm">
          <ul className="space-y-1 text-xs text-muted-foreground">
            <li className="flex items-center gap-1.5">
              <Container className="size-3.5 shrink-0" aria-hidden />
              <span>
                {translate(
                  'components.devops.local.build',
                  'Build {{image}} from {{dockerfile}} with {{runtime}}',
                  {
                    image: plan.image,
                    dockerfile: plan.dockerfile,
                    runtime: plan.runtime
                  }
                )}
              </span>
            </li>
            <li>
              {translate('components.devops.local.load', 'Load it into {{tool}} cluster {{name}}', {
                tool: plan.cluster.tool,
                name: plan.cluster.name
              })}
            </li>
            <li>
              {translate(
                'components.devops.local.apply',
                'Deploy {{path}} ({{kind}}) into namespace {{namespace}}',
                {
                  path: plan.source.path,
                  kind: plan.source.kind,
                  namespace: plan.namespace
                }
              )}
            </li>
            <li>
              {translate(
                'components.devops.local.retarget',
                'Run the local build in: {{targets}}',
                {
                  targets: plan.targets
                    .map((target) => `${target.name}/${target.container}`)
                    .join(', ')
                }
              )}
            </li>
          </ul>
          <Button type="button" size="xs" onClick={run}>
            <Play aria-hidden />
            {translate('components.devops.local.run', 'Build and run on {{name}}', {
              name: plan.cluster.name
            })}
          </Button>
        </div>
      )}
    </InfraCard>
  )
}
