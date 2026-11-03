import { useEffect, useRef, useState } from 'react'
import { GitBranch, Rocket, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAppStore } from '@/store'
import { selectKnownWorktreeById } from '@/store/selectors'
import { translate } from '@/i18n/i18n'
import { openInWorkbenchBrowser, runInWorkbenchTerminal } from '../workbench/workbench-terminals'
import { InfraCard } from './InfraHomeCards'
import type { DevopsContext } from '../../../../shared/fork-devops-context'
import { devopsCommandLine, type DevopsInspection } from '../../../../shared/fork-devops-inspection'
import {
  ARGO_UI_PORT,
  argoApplicationYaml,
  argoDeploySteps,
  type ArgoDeployPlan
} from '../../../../shared/fork-devops-argo-deploy'

const UI_POLL_MS = 3_000
const UI_POLL_LIMIT = 300

/** Path stage 3: this repo into Argo CD on the local cluster, then the UI opened on the app. */
export function InfraArgoDeploy({
  worktreeId,
  inspection,
  context,
  clusterAnswers,
  gitopsRepo
}: {
  worktreeId: string
  /** A confirmed sibling GitOps repo deploys instead of the open one. */
  gitopsRepo: { path: string; folder: string } | null
  inspection: DevopsInspection | null
  context: DevopsContext
  clusterAnswers: boolean
}): React.JSX.Element {
  const path = useAppStore((state) => selectKnownWorktreeById(state, worktreeId)?.path)
  const [plan, setPlan] = useState<ArgoDeployPlan | null>(null)
  const [source, setSource] = useState(0)
  const [status, setStatus] = useState<string | null>(null)
  const polling = useRef<number | undefined>(undefined)
  const kube = context.kube

  useEffect(() => {
    if (!path || !clusterAnswers) {
      return
    }
    let current = true
    void window.api.aiVault
      .argoDeployPlan({ repoPath: gitopsRepo?.path ?? path, clusterPath: path })
      .then((next) => {
        if (current) {
          setPlan(next)
          setSource(0)
        }
      })
    return () => {
      current = false
    }
  }, [path, clusterAnswers, kube?.context, gitopsRepo?.path])
  useEffect(() => () => window.clearInterval(polling.current), [])

  const blocked = !kube
    ? translate('components.devops.argo.noCluster', 'Start a local cluster first.')
    : kube.tone !== 'local'
      ? translate(
          'components.devops.argo.notLocal',
          'This deploys to local clusters only. {{context}} is not one.',
          { context: kube.context }
        )
      : !clusterAnswers
        ? translate('components.devops.argo.down', 'The cluster is not answering.')
        : null

  const deploy = async (): Promise<void> => {
    if (!plan?.ok) {
      return
    }
    const chosen = plan.sources[source]
    const appFile = await window.api.aiVault.writeArgoApplication({
      name: plan.name,
      yaml: argoApplicationYaml({
        name: plan.name,
        repoURL: plan.repoURL,
        revision: plan.branch,
        source: chosen,
        namespace: plan.name
      })
    })
    if (!appFile) {
      setStatus(
        translate('components.devops.argo.writeFailed', 'Could not write the Application file.')
      )
      return
    }
    const tool = inspection?.tools.kubectl
    const shell = inspection?.shell
    runInWorkbenchTerminal(
      worktreeId,
      devopsCommandLine(
        tool,
        argoDeploySteps({ argoInstalled: plan.argoInstalled, appFile, name: plan.name }).join(
          ' && '
        ),
        shell
      )
    )
    // A second terminal holds the UI open once Argo CD exists; the first one keeps the deploy log.
    runInWorkbenchTerminal(
      worktreeId,
      devopsCommandLine(
        tool,
        `kubectl -n argocd wait --for=create deploy/argocd-server --timeout=900s && kubectl -n argocd rollout status deploy/argocd-server --timeout=900s && kubectl -n argocd port-forward svc/argocd-server ${ARGO_UI_PORT}:443`,
        shell
      )
    )
    setStatus(
      translate(
        'components.devops.argo.waiting',
        'Deploying… the Argo CD UI opens when it answers.'
      )
    )
    let tries = 0
    window.clearInterval(polling.current)
    polling.current = window.setInterval(() => {
      tries += 1
      void window.api.aiVault.probeArgoUi().then((up) => {
        if (up) {
          window.clearInterval(polling.current)
          setStatus(
            translate(
              'components.devops.argo.open',
              'Argo CD is up. Log in as admin; the password is in the deploy terminal.'
            )
          )
          openInWorkbenchBrowser(
            worktreeId,
            `https://localhost:${ARGO_UI_PORT}/applications/argocd/${plan.name}`,
            'Argo CD'
          )
        } else if (tries >= UI_POLL_LIMIT) {
          window.clearInterval(polling.current)
          setStatus(
            translate(
              'components.devops.argo.timeout',
              'Argo CD did not come up. Check the terminals.'
            )
          )
        }
      })
    }, UI_POLL_MS)
  }

  return (
    <InfraCard
      className="mb-4"
      title={translate('components.devops.argo.title', 'Deploy this repo with Argo CD')}
      hint={translate(
        'components.devops.argo.hint',
        'Argo CD watches the pushed repo and keeps the cluster in sync with it.'
      )}
    >
      {blocked ? (
        <p className="text-xs text-muted-foreground">{blocked}</p>
      ) : !plan ? (
        <p className="text-xs text-muted-foreground">
          {translate('components.devops.argo.reading', 'Reading the repo and the cluster…')}
        </p>
      ) : !plan.ok ? (
        <p className="text-xs text-destructive">{plan.error}</p>
      ) : (
        <div className="space-y-2 text-sm">
          <div className="flex items-center gap-2">
            <GitBranch className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="min-w-0 truncate font-mono text-xs">
              {gitopsRepo ? `${gitopsRepo.folder} · ` : ''}
              {plan.repoURL} @ {plan.branch}
            </span>
          </div>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            {translate('components.devops.argo.path', 'Deploy')}
            <select
              className="rounded-md border border-border bg-background px-2 py-1 font-mono text-xs text-foreground"
              value={source}
              onChange={(event) => setSource(Number(event.target.value))}
            >
              {plan.sources.map((item, index) => (
                <option key={item.path} value={index}>
                  {item.path} ({item.kind})
                </option>
              ))}
            </select>
            {translate('components.devops.argo.into', 'into namespace {{name}}', {
              name: plan.name
            })}
          </label>
          <ul className="space-y-1 text-xs text-muted-foreground">
            <li>
              {plan.argoInstalled
                ? translate(
                    'components.devops.argo.reuse',
                    'Argo CD is already in the cluster: it is reused, never reinstalled.'
                  )
                : translate(
                    'components.devops.argo.install',
                    'Argo CD is not in the cluster: it will be installed.'
                  )}
            </li>
            {plan.unpushed === null || plan.unpushed > 0 ? (
              <li className="flex gap-1 text-status-warning">
                <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                {plan.unpushed === null
                  ? translate(
                      'components.devops.argo.noUpstream',
                      'This branch is not pushed. Argo CD only sees what is on the remote.'
                    )
                  : translate(
                      'components.devops.argo.unpushed',
                      '{{count}} commits are not pushed; Argo CD will not see them.',
                      {
                        count: plan.unpushed
                      }
                    )}
              </li>
            ) : null}
            <li>
              {translate(
                'components.devops.argo.adopt',
                'Anything already applied by hand with the same names is taken over by Argo CD. Private repos need Argo CD read access (not set up by this button yet).'
              )}
            </li>
          </ul>
          <div className="flex items-center gap-2 pt-1">
            <Button type="button" size="xs" onClick={() => void deploy()}>
              <Rocket aria-hidden />
              {translate('components.devops.argo.deploy', 'Deploy with Argo CD')}
            </Button>
            {status ? <span className="text-xs text-muted-foreground">{status}</span> : null}
          </div>
        </div>
      )}
    </InfraCard>
  )
}
