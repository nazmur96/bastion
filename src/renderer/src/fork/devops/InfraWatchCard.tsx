import { useEffect, useRef, useState } from 'react'
import { Activity } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { openInWorkbenchBrowser, runInWorkbenchTerminal } from '../workbench/workbench-terminals'
import { InfraCard } from './InfraHomeCards'
import { useDeckCommands } from './command-deck-store'
import { startSteps } from './steps-store'
import type { DevopsContext } from '../../../../shared/fork-devops-context'
import { devopsCommandLine, type DevopsInspection } from '../../../../shared/fork-devops-inspection'
import {
  grafanaForward,
  observabilitySteps,
  type ObservabilityPlan
} from '../../../../shared/fork-devops-observability'

const POLL_MS = 3_000
const POLL_LIMIT = 300

/** Observability: Prometheus + Grafana watching this app, its dashboard opened in the workbench. */
export function InfraWatchCard({
  worktreeId,
  workspacePath,
  namespace,
  inspection,
  context,
  clusterAnswers
}: {
  worktreeId: string
  workspacePath: string
  /** The app's namespace (the one Run this app deploys into). */
  namespace: string
  inspection: DevopsInspection | null
  context: DevopsContext
  clusterAnswers: boolean
}): React.JSX.Element {
  const [plan, setPlan] = useState<ObservabilityPlan | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [armed, setArmed] = useState(false)
  const polling = useRef<number | undefined>(undefined)
  const kube = context.kube
  const real = kube !== undefined && kube.tone !== 'local'
  useEffect(() => {
    if (!kube?.context || !clusterAnswers) {
      return
    }
    let current = true
    void window.api.aiVault.observabilityPlan({ workspacePath, namespace }).then((next) => {
      if (current) {
        setPlan(next)
      }
    })
    return () => {
      current = false
    }
  }, [workspacePath, namespace, kube?.context, clusterAnswers])
  useEffect(() => () => window.clearInterval(polling.current), [])

  const watch = (): void => {
    if (!plan?.ok) {
      return
    }
    const line = (command: string): string =>
      devopsCommandLine(inspection?.tools.kubectl, command, inspection?.shell)
    startSteps({
      title: translate('components.devops.watch.title', 'Watch it · metrics and dashboard'),
      workspacePath,
      steps: observabilitySteps(plan).map(line)
    })
    if (!plan.grafana) {
      setStatus(
        translate(
          'components.devops.watch.noGrafana',
          'Applied. This cluster has no Grafana to open.'
        )
      )
      return
    }
    const grafana = plan.grafana
    runInWorkbenchTerminal(worktreeId, line(grafanaForward(grafana, plan.grafanaPort)))
    setStatus(
      translate('components.devops.watch.waiting', 'Setting up… Grafana opens when it answers.')
    )
    let tries = 0
    window.clearInterval(polling.current)
    polling.current = window.setInterval(() => {
      tries += 1
      void window.api.aiVault.probeGrafana(plan.grafanaPort).then((up) => {
        if (up) {
          window.clearInterval(polling.current)
          setStatus(
            translate(
              'components.devops.watch.open',
              'Grafana is up. Log in as admin; the password is in its terminal.'
            )
          )
          openInWorkbenchBrowser(
            worktreeId,
            `http://localhost:${plan.grafanaPort}/d/${plan.dashboardUid}`,
            'Grafana'
          )
        } else if (tries >= POLL_LIMIT) {
          window.clearInterval(polling.current)
          setStatus(
            translate(
              'components.devops.watch.timeout',
              'Grafana did not come up. Check the terminals.'
            )
          )
        }
      })
    }, POLL_MS)
  }

  useDeckCommands(
    'path:watch',
    plan?.ok
      ? [
          {
            id: 'path:watch',
            group: translate('components.devops.deck.path', 'Project path'),
            label: translate(
              'components.devops.watch.button',
              'Watch it with Prometheus + Grafana'
            ),
            keywords: ['grafana', 'prometheus', 'monitoring', 'observability', 'metrics'],
            run: watch
          }
        ]
      : []
  )

  return (
    <InfraCard
      id="infra-path-watch"
      className="mb-4"
      title={translate('components.devops.watch.title', 'Watch it · metrics and dashboard')}
      hint={translate(
        'components.devops.watch.hint',
        'Prometheus scrapes the app, Grafana shows a dashboard for its namespace. The map’s Metrics lens works without this.'
      )}
    >
      {!kube || !clusterAnswers ? (
        <p className="text-xs text-muted-foreground">
          {translate('components.devops.watch.noCluster', 'Needs a cluster that answers.')}
        </p>
      ) : !plan ? (
        <p className="text-xs text-muted-foreground">
          {translate(
            'components.devops.watch.reading',
            'Looking for Prometheus and the app’s Services…'
          )}
        </p>
      ) : !plan.ok ? (
        <p className="text-xs text-destructive">{plan.error}</p>
      ) : (
        <div className="space-y-2">
          <ul className="space-y-1 text-xs text-muted-foreground">
            <li>
              {plan.stackInstalled
                ? translate(
                    'components.devops.watch.reuse',
                    'Prometheus is already in the cluster: it is reused, never reinstalled.'
                  )
                : translate(
                    'components.devops.watch.install',
                    'Prometheus + Grafana are not in the cluster: they will be installed (kube-prometheus-stack).'
                  )}
            </li>
            <li>
              {plan.targets.length > 0
                ? translate(
                    'components.devops.watch.scrape',
                    'Scrape /metrics on: {{targets}}. An app that does not serve /metrics shows as down there; CPU, memory and restarts still work.',
                    {
                      targets: plan.targets
                        .map((target) => `${target.service}:${target.port}`)
                        .join(', ')
                    }
                  )
                : translate(
                    'components.devops.watch.noTargets',
                    'No labelled Service with a named port in {{namespace}}: CPU, memory and restarts still show.',
                    { namespace }
                  )}
            </li>
            <li>
              {translate(
                'components.devops.watch.dashboard',
                'Dashboard “{{namespace}} · Bastion”: CPU, memory, restarts, request rate.',
                {
                  namespace
                }
              )}
            </li>
          </ul>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="xs"
              variant={real && armed ? 'destructive' : 'default'}
              onBlur={() => setArmed(false)}
              onClick={() => {
                if (real && !armed) {
                  setArmed(true)
                  return
                }
                setArmed(false)
                watch()
              }}
            >
              <Activity aria-hidden />
              {real && armed
                ? translate(
                    'components.devops.watch.confirmReal',
                    'Click again to install on {{context}}',
                    {
                      context: kube.context
                    }
                  )
                : translate('components.devops.watch.button', 'Watch it with Prometheus + Grafana')}
            </Button>
            {status ? <span className="text-xs text-muted-foreground">{status}</span> : null}
          </div>
        </div>
      )}
    </InfraCard>
  )
}
