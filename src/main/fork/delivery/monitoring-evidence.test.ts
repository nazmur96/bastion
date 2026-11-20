import { describe, expect, it } from 'vitest'
import type { DeliveryConfig } from '../../../shared/fork-delivery/delivery-contract'
import { monitoringConfigSchema } from '../../../shared/fork-delivery/monitoring-contract'
import { readMonitoringEvidence, type MonitoringDeps } from './monitoring-evidence'

const NOW = Date.parse('2026-11-20T12:00:00Z')
const request: DeliveryConfig = {
  projectId: 'p',
  repository: 'example/app',
  workflow: 'build.yml',
  configPath: 'deploy/kustomization.yaml',
  imageName: 'app',
  application: 'app',
  applicationNamespace: 'argocd',
  revision: null
}
const app = JSON.stringify({ spec: { destination: { namespace: 'shop' } } })
const vector = (value?: string) =>
  JSON.stringify({
    status: 'success',
    data: {
      resultType: 'vector',
      result: value === undefined ? [] : [{ metric: {}, value: [NOW / 1000, value] }]
    }
  })
/** Answers by PromQL fragment; anything unlisted is an empty vector (metric absent). */
function prometheus(answers: Record<string, string>, alerts: unknown[] = []) {
  return (path: string): string => {
    if (path.startsWith('/api/v1/status/buildinfo')) {
      return JSON.stringify({ status: 'success', data: { version: '3.7.0' } })
    }
    if (path.startsWith('/api/v1/alerts')) {
      return JSON.stringify({ status: 'success', data: { alerts } })
    }
    const query = new URLSearchParams(path.split('?')[1]).get('query') ?? ''
    const hit = Object.entries(answers).find(([fragment]) => query.startsWith(fragment))
    return vector(hit?.[1])
  }
}
function deps(options: {
  config: unknown
  answer?: (path: string) => string
  kubectlRaw?: { ok: boolean; code: string; out: string }
  http?: MonitoringDeps['http']
  env?: Record<string, string>
}): MonitoringDeps & { calls: string[][]; headers: Record<string, string>[] } {
  const calls: string[][] = []
  const headers: Record<string, string>[] = []
  return {
    calls,
    headers,
    env: options.env ?? {},
    readConfig: async () =>
      options.config === null
        ? null
        : typeof options.config === 'string'
          ? options.config
          : JSON.stringify(options.config),
    kubectl: async (args) => {
      calls.push(args)
      if (args.includes('applications.argoproj.io')) {
        return { ok: true, code: 'ok', out: app }
      }
      if (options.kubectlRaw) {
        return options.kubectlRaw
      }
      const path = args[2].replace(/^\/api\/v1\/namespaces\/[^/]+\/services\/[^/]+\/proxy/, '')
      return { ok: true, code: 'ok', out: options.answer?.(path) ?? vector() }
    },
    http:
      options.http ??
      (async (url, sent) => {
        headers.push(sent)
        const parsed = new URL(url)
        return { status: 200, body: options.answer?.(parsed.pathname + parsed.search) ?? '{}' }
      })
  }
}
const service = {
  version: 1,
  prometheus: { service: { namespace: 'monitoring', name: 'prometheus', port: 9090 } }
}
const healthy = {
  'sum(up{': '2',
  'count(up{': '2',
  'max(timestamp(up{': String(NOW / 1000 - 20),
  'sum(increase(kube_pod_container_status_restarts_total': '0',
  'sum(rate(http_requests_total{namespace="shop"}[5m]))': '10',
  'sum(rate(http_requests_total{namespace="shop",code': '0.01',
  'histogram_quantile(0.95': '0.12'
}
const brief = (items: { status: string; detail: string }[]) =>
  items.map((item) => [item.status, item.detail])

describe('monitoring evidence', () => {
  it('is not attached without monitoring.json, and never contacts anything', async () => {
    const source = deps({ config: null })
    const evidence = await readMonitoringEvidence(request, source, NOW)
    expect([evidence.attached, evidence.connectors, source.calls]).toEqual([false, [], []])
  })
  it('rejects plain http off loopback, credentials in URLs and unknown keys', () => {
    for (const url of [
      'http://prom.example',
      'https://u:p@prom.example',
      'https://prom.example?x=1'
    ]) {
      expect(monitoringConfigSchema.safeParse({ version: 1, prometheus: { url } }).success).toBe(
        false
      )
    }
    expect(
      monitoringConfigSchema.safeParse({ version: 1, prometheus: { url: 'http://127.0.0.1:9090' } })
        .success
    ).toBe(true)
    expect(monitoringConfigSchema.safeParse({ ...service, token: 'x' }).success).toBe(false)
  })
  it('reads healthy signals through the cluster service proxy, scoped to the namespace', async () => {
    const source = deps({ config: service, answer: prometheus(healthy) })
    const evidence = await readMonitoringEvidence(request, source, NOW)
    const [connector] = evidence.connectors
    expect(
      [connector.reachable, connector.auth, connector.freshness].map((item) => item?.detail)
    ).toEqual(['Prometheus 3.7.0', 'allowed by cluster RBAC', 'newest sample 20 s old'])
    expect(brief(evidence.signals)).toEqual([
      ['verified', '2/2 targets up'],
      ['verified', 'no restarts in the last hour'],
      ['verified', '0.10% 5xx over 5 minutes (limit 1.00%)'],
      ['verified', '120 ms over 5 minutes (limit 1000 ms)']
    ])
    expect(
      evidence.signals.every(
        (signal) => signal.query.includes('namespace="shop"') && signal.link === null
      )
    ).toBe(true)
    expect(source.calls[1].slice(0, 2)).toEqual(['get', '--raw'])
    expect(source.calls[1][2]).toMatch(
      /^\/api\/v1\/namespaces\/monitoring\/services\/prometheus:9090\/proxy\/api\/v1\/status\/buildinfo$/
    )
  })
  it('reports problems, and keeps absent metrics unknown', async () => {
    const evidence = await readMonitoringEvidence(
      request,
      deps({
        config: { ...service, thresholds: { p95Ms: 100 } },
        answer: prometheus(
          {
            'sum(up{': '1',
            'count(up{': '2',
            'max(timestamp(up{': String(NOW / 1000 - 900),
            'sum(increase(kube_pod_container_status_restarts_total': '3.2',
            'histogram_quantile(0.95': '0.25'
          },
          [
            {
              labels: { alertname: 'PodCrashLooping', namespace: 'shop', severity: 'warning' },
              state: 'firing',
              activeAt: '2026-11-20T11:50:00Z'
            },
            { labels: { alertname: 'Other', namespace: 'billing' }, state: 'firing' },
            { labels: { alertname: 'Quiet', namespace: 'shop' }, state: 'inactive' }
          ]
        )
      }),
      NOW
    )
    expect(evidence.connectors[0].freshness?.detail).toBe('newest sample 15 min old')
    expect(brief(evidence.signals)).toEqual([
      ['mismatch', '1/2 targets up'],
      ['mismatch', '3 restarts in the last hour'],
      ['unknown', 'http_requests_total not found'],
      ['mismatch', '250 ms over 5 minutes (limit 100 ms)']
    ])
    expect(evidence.alerts.map((alert) => [alert.name, alert.state, alert.link])).toEqual([
      ['PodCrashLooping', 'firing', null]
    ])
  })
  it('uses the token named by tokenEnv, never stores it, and separates auth from reachability', async () => {
    const ok = deps({
      config: {
        version: 1,
        prometheus: { url: 'https://prom.example/', tokenEnv: 'PROM_TOKEN' },
        grafana: { url: 'https://grafana.example', tokenEnv: 'GRAFANA_TOKEN' }
      },
      env: { PROM_TOKEN: 'secret-value' },
      answer: (path) =>
        path.startsWith('/api/health')
          ? JSON.stringify({ database: 'ok', version: '12.2.0' })
          : prometheus(healthy)(path)
    })
    const evidence = await readMonitoringEvidence(request, ok, NOW)
    expect(ok.headers[0].Authorization).toBe('Bearer secret-value')
    expect(JSON.stringify(evidence)).not.toContain('secret-value')
    expect(evidence.signals[0].link).toMatch(
      /^https:\/\/prom\.example\/graph\?g0\.expr=sum\(up%7Bnamespace%3D%22shop%22%7D\)/
    )
    expect(evidence.links.map((link) => link.label)).toEqual([
      'Grafana alert rules for shop',
      'Prometheus alerts'
    ])
    expect(brief([evidence.connectors[1].reachable, evidence.connectors[1].auth])).toEqual([
      ['verified', 'Grafana 12.2.0'],
      ['unknown', "GRAFANA_TOKEN is not set on the project's owner"]
    ])
    const denied = await readMonitoringEvidence(
      request,
      deps({
        config: { version: 1, prometheus: { url: 'https://prom.example' } },
        http: async () => ({ status: 401, body: '' })
      }),
      NOW
    )
    expect(
      brief([
        denied.connectors[0].reachable,
        denied.connectors[0].auth,
        denied.connectors[0].freshness!
      ])
    ).toEqual([
      ['verified', 'reachable'],
      ['mismatch', 'rejected (401)'],
      ['unknown', 'not reached']
    ])
    expect(denied.signals).toEqual([])
    const down = await readMonitoringEvidence(
      request,
      deps({
        config: { version: 1, prometheus: { url: 'https://prom.example' } },
        http: async () => {
          throw Object.assign(new Error('fetch failed'), { cause: { code: 'ECONNREFUSED' } })
        }
      }),
      NOW
    )
    expect(brief([down.connectors[0].reachable])).toEqual([['mismatch', 'ECONNREFUSED']])
  })
  it('classifies a refused or missing cluster service', async () => {
    const forbidden = await readMonitoringEvidence(
      request,
      deps({
        config: service,
        kubectlRaw: {
          ok: false,
          code: 'failed',
          out: 'Error from server (Forbidden): services "prometheus:9090" is forbidden'
        }
      }),
      NOW
    )
    expect(forbidden.connectors[0].auth.status).toBe('mismatch')
    const missing = await readMonitoringEvidence(
      request,
      deps({
        config: service,
        kubectlRaw: {
          ok: false,
          code: 'failed',
          out: 'Error from server (NotFound): services "prometheus" not found'
        }
      }),
      NOW
    )
    expect(brief([missing.connectors[0].reachable])).toEqual([
      ['mismatch', 'service not reachable through the cluster']
    ])
    const invalid = await readMonitoringEvidence(request, deps({ config: '{"version":2}' }), NOW)
    expect(invalid.unknown).toEqual(['.bastion/monitoring.json is unreadable or invalid'])
  })
})
