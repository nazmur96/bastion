import { app } from 'electron'
import { mkdirSync, writeFileSync } from 'node:fs'
import { request } from 'node:http'
import { join } from 'node:path'
import { kubectlIn } from './devops-kubectl'
import { freeLocalPort } from './devops-ports'
import {
  GRAFANA_PORT,
  dashboardConfigMap,
  scrapeTargets,
  serviceMonitorYaml,
  type ObservabilityPlan
} from '../../../shared/fork-devops-observability'

function grafanaService(servicesJson: string): { namespace: string; service: string } | null {
  try {
    const items: unknown = JSON.parse(servicesJson)?.items
    const first: unknown = Array.isArray(items) ? items[0] : null
    const metadata: unknown =
      first && typeof first === 'object' ? Reflect.get(first, 'metadata') : null
    const namespace: unknown =
      metadata && typeof metadata === 'object' ? Reflect.get(metadata, 'namespace') : null
    const service: unknown =
      metadata && typeof metadata === 'object' ? Reflect.get(metadata, 'name') : null
    return typeof namespace === 'string' && typeof service === 'string'
      ? { namespace, service }
      : null
  } catch {
    return null
  }
}

/**
 * Reads the cluster (read-only) and writes the app's ServiceMonitor and dashboard to userData;
 * nothing is applied here. An existing Prometheus Operator and Grafana are reused, never replaced.
 */
export async function prepareObservability(
  workspacePath: string,
  namespace: string
): Promise<ObservabilityPlan> {
  const [crd, grafana, services] = await Promise.all([
    kubectlIn(workspacePath, [
      'get',
      'crd',
      'servicemonitors.monitoring.coreos.com',
      '-o',
      'name',
      '--request-timeout=8s'
    ]),
    kubectlIn(workspacePath, [
      'get',
      'svc',
      '--all-namespaces',
      '-l',
      'app.kubernetes.io/name=grafana',
      '-o',
      'json',
      '--request-timeout=8s'
    ]),
    kubectlIn(workspacePath, ['-n', namespace, 'get', 'svc', '-o', 'json', '--request-timeout=8s'])
  ])
  if (!services.ok) {
    return { ok: false, error: services.out }
  }
  const stackInstalled = crd.ok && crd.out.includes('servicemonitors.monitoring.coreos.com')
  const targets = scrapeTargets(services.out)
  const dir = join(app.getPath('userData'), 'fork-observability')
  mkdirSync(dir, { recursive: true })
  const dashboardUid = `bastion-${namespace}`.slice(0, 40)
  const dashboard = join(dir, `${namespace}-dashboard.yaml`)
  writeFileSync(dashboard, dashboardConfigMap(namespace, dashboardUid))
  let serviceMonitor: string | null = null
  if (targets.length > 0) {
    serviceMonitor = join(dir, `${namespace}-servicemonitor.yaml`)
    writeFileSync(serviceMonitor, serviceMonitorYaml(namespace, targets))
  }
  return {
    ok: true,
    namespace,
    stackInstalled,
    // When the stack is installed by Watch it, its Grafana gets the chart's default name.
    grafana:
      (grafana.ok ? grafanaService(grafana.out) : null) ??
      (stackInstalled ? null : { namespace: 'monitoring', service: 'monitoring-grafana' }),
    targets,
    files: { serviceMonitor, dashboard },
    dashboardUid,
    grafanaPort: await freeLocalPort(GRAFANA_PORT)
  }
}

/** Whether the forwarded Grafana answers yet. */
export function probeGrafana(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const req = request({ host: '127.0.0.1', port, path: '/api/health', timeout: 2_000 }, (res) => {
      res.resume()
      resolve(true)
    })
    req.on('timeout', () => req.destroy())
    req.on('error', () => resolve(false))
    req.end()
  })
}
