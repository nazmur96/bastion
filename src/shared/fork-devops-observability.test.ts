import { describe, expect, it } from 'vitest'
import {
  LOKI_VALUES,
  dashboardConfigMap,
  logsSteps,
  lokiDatasourceConfigMap,
  grafanaForward,
  observabilitySteps,
  scrapeTargets,
  serviceMonitorYaml
} from './fork-devops-observability'

const services = JSON.stringify({
  items: [
    {
      metadata: { name: 'hello', labels: { app: 'hello' } },
      spec: { ports: [{ name: 'http', port: 80 }] }
    },
    { metadata: { name: 'unlabelled' }, spec: { ports: [{ name: 'http', port: 80 }] } },
    { metadata: { name: 'unnamed-port', labels: { app: 'x' } }, spec: { ports: [{ port: 80 }] } }
  ]
})

describe('observability', () => {
  it('scrapes only Services a ServiceMonitor can select by label and named port', () => {
    expect(scrapeTargets(services)).toEqual([
      { service: 'hello', port: 'http', labels: { app: 'hello' } }
    ])
    expect(scrapeTargets('nope')).toEqual([])
  })

  it('writes a ServiceMonitor that selects the Service and scrapes /metrics', () => {
    const yaml = serviceMonitorYaml('hello', scrapeTargets(services))
    expect(yaml).toContain('kind: ServiceMonitor')
    expect(yaml).toContain('      app: "hello"')
    expect(yaml).toContain('    - port: http')
  })

  it('packs the dashboard as a sidecar-loaded ConfigMap scoped to the namespace', () => {
    const map = dashboardConfigMap('hello', 'bastion-hello')
    expect(map).toContain('grafana_dashboard: "1"')
    const json = JSON.parse(JSON.parse(map.split('hello.json: ')[1]))
    expect(json.uid).toBe('bastion-hello')
    expect(json.panels[0].targets[0].expr).toContain('namespace="hello"')
  })

  it('adds Loki, Promtail and the Grafana data source that the logs panel uses', () => {
    const steps = logsSteps({ lokiValues: '/l.yaml', lokiDatasource: '/ds.yaml' }, 'monitoring')
    expect(steps[0]).toContain(
      'helm upgrade --install loki loki --repo https://grafana.github.io/helm-charts'
    )
    expect(steps[1]).toContain('config.clients[0].url=http://loki.monitoring:3100/loki/api/v1/push')
    expect(lokiDatasourceConfigMap('monitoring')).toContain('uid: loki')
    expect(LOKI_VALUES).toContain('deploymentMode: SingleBinary')
    const panels = JSON.parse(
      JSON.parse(dashboardConfigMap('hello', 'u').split('hello.json: ')[1])
    ).panels
    expect(panels.find((panel: { type: string }) => panel.type === 'logs').targets[0].expr).toBe(
      '{namespace="hello"}'
    )
  })

  it('installs the stack only when missing, and never needs base64 for the password', () => {
    const base = {
      ok: true as const,
      namespace: 'hello',
      grafana: { namespace: 'monitoring', service: 'monitoring-grafana' },
      targets: [],
      files: {
        serviceMonitor: null,
        dashboard: '/d.yaml',
        lokiValues: '/l.yaml',
        lokiDatasource: '/ds.yaml'
      },
      lokiInstalled: false,
      dashboardUid: 'bastion-hello',
      grafanaPort: 3001
    }
    expect(observabilitySteps({ ...base, stackInstalled: false })[0]).toMatch(
      /^helm install monitoring /
    )
    expect(observabilitySteps({ ...base, stackInstalled: true })).toEqual([
      'kubectl apply -f "/d.yaml"'
    ])
    expect(grafanaForward(base.grafana, 3001)).not.toContain('base64 -d')
    expect(grafanaForward(base.grafana, 3001)).toContain(
      'port-forward svc/monitoring-grafana 3001:80'
    )
  })
})
