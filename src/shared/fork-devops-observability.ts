/** Fork, observability: Prometheus + Grafana watching this app, set up in one click. */
export type ScrapeTarget = { service: string; port: string; labels: Record<string, string> }

export type ObservabilityPlan =
  | {
      ok: true
      namespace: string
      /** kube-prometheus-stack (or any Prometheus Operator) is already in the cluster. */
      stackInstalled: boolean
      grafana: { namespace: string; service: string } | null
      targets: ScrapeTarget[]
      /** Written to userData; applied by the Watch it terminal. */
      files: { serviceMonitor: string | null; dashboard: string }
      dashboardUid: string
      /** A local port free right now for the Grafana port-forward. */
      grafanaPort: number
    }
  | { ok: false; error: string }

export const GRAFANA_PORT = 3000

function at(value: unknown, ...keys: string[]): unknown {
  let current = value
  for (const key of keys) {
    if (current === null || typeof current !== 'object') {
      return undefined
    }
    current = Reflect.get(current, key)
  }
  return current
}

function stringRecord(value: unknown): Record<string, string> {
  return value !== null && typeof value === 'object'
    ? Object.fromEntries(
        Object.entries(value).filter(
          (entry): entry is [string, string] => typeof entry[1] === 'string'
        )
      )
    : {}
}

/** The app's Services that can be selected (they have labels) and their first named port. */
export function scrapeTargets(servicesJson: string): ScrapeTarget[] {
  let items: unknown
  try {
    items = at(JSON.parse(servicesJson), 'items')
  } catch {
    return []
  }
  return (Array.isArray(items) ? items : []).flatMap((service): ScrapeTarget[] => {
    const name = at(service, 'metadata', 'name')
    const labels = stringRecord(at(service, 'metadata', 'labels'))
    const ports = at(service, 'spec', 'ports')
    const port = (Array.isArray(ports) ? ports : [])
      .map((entry) => at(entry, 'name'))
      .find((value) => typeof value === 'string' && value !== '')
    return typeof name === 'string' && typeof port === 'string' && Object.keys(labels).length > 0
      ? [{ service: name, port, labels }]
      : []
  })
}

function yamlMap(record: Record<string, string>, indent: string): string[] {
  return Object.entries(record).map(([key, value]) => `${indent}${key}: ${JSON.stringify(value)}`)
}

/** One ServiceMonitor per app Service, scraping /metrics on its named port. */
export function serviceMonitorYaml(namespace: string, targets: readonly ScrapeTarget[]): string {
  return targets
    .map((target) =>
      [
        'apiVersion: monitoring.coreos.com/v1',
        'kind: ServiceMonitor',
        'metadata:',
        `  name: ${target.service}`,
        `  namespace: ${namespace}`,
        'spec:',
        '  selector:',
        '    matchLabels:',
        ...yamlMap(target.labels, '      '),
        '  endpoints:',
        `    - port: ${target.port}`,
        '      path: /metrics',
        '      interval: 30s'
      ].join('\n')
    )
    .join('\n---\n')
}

/** A Grafana dashboard for the namespace: CPU, memory, restarts, and request rate when the app exports it. */
export function dashboardConfigMap(namespace: string, uid: string): string {
  const panel = (id: number, title: string, expr: string, x: number, y: number, unit: string) => ({
    id,
    type: 'timeseries',
    title,
    gridPos: { h: 8, w: 12, x, y },
    fieldConfig: { defaults: { unit } },
    targets: [{ expr, refId: 'A', legendFormat: '{{pod}}' }]
  })
  const dashboard = {
    uid,
    title: `${namespace} · Bastion`,
    tags: ['bastion'],
    time: { from: 'now-1h', to: 'now' },
    refresh: '30s',
    panels: [
      panel(
        1,
        'CPU (cores)',
        `sum by (pod) (rate(container_cpu_usage_seconds_total{namespace="${namespace}",container!=""}[2m]))`,
        0,
        0,
        'short'
      ),
      panel(
        2,
        'Memory',
        `sum by (pod) (container_memory_working_set_bytes{namespace="${namespace}",container!=""})`,
        12,
        0,
        'bytes'
      ),
      panel(
        3,
        'Restarts',
        `sum by (pod) (kube_pod_container_status_restarts_total{namespace="${namespace}"})`,
        0,
        8,
        'short'
      ),
      panel(
        4,
        'HTTP requests / s (if the app exports http_requests_total)',
        `sum by (pod) (rate(http_requests_total{namespace="${namespace}"}[2m]))`,
        12,
        8,
        'reqps'
      )
    ]
  }
  return [
    'apiVersion: v1',
    'kind: ConfigMap',
    'metadata:',
    `  name: bastion-dashboard-${namespace}`,
    `  namespace: ${namespace}`,
    '  labels:',
    '    grafana_dashboard: "1"',
    'data:',
    `  ${namespace}.json: ${JSON.stringify(JSON.stringify(dashboard))}`,
    ''
  ].join('\n')
}

/** Install the stack only when it is missing, then apply the app's monitor and dashboard. */
export function observabilitySteps(plan: Extract<ObservabilityPlan, { ok: true }>): string[] {
  return [
    ...(plan.stackInstalled
      ? []
      : [
          'helm install monitoring oci://ghcr.io/prometheus-community/charts/kube-prometheus-stack -n monitoring --create-namespace --wait --timeout 10m --set prometheus.prometheusSpec.serviceMonitorSelectorNilUsesHelmValues=false --set grafana.sidecar.dashboards.searchNamespace=ALL'
        ]),
    ...(plan.files.serviceMonitor ? [`kubectl apply -f "${plan.files.serviceMonitor}"`] : []),
    `kubectl apply -f "${plan.files.dashboard}"`
  ]
}

/** The port-forward that keeps Grafana open, and how to read its admin password without base64. */
export function grafanaForward(
  grafana: { namespace: string; service: string },
  port: number
): string {
  return [
    `kubectl -n ${grafana.namespace} wait --for=create deploy/${grafana.service} --timeout=900s`,
    `kubectl -n ${grafana.namespace} rollout status deploy/${grafana.service} --timeout=900s`,
    `kubectl -n ${grafana.namespace} get secret ${grafana.service} -o go-template='admin password: {{index .data "admin-password" | base64decode}}{{println}}'`,
    `kubectl -n ${grafana.namespace} port-forward svc/${grafana.service} ${port}:80`
  ].join(' && ')
}
