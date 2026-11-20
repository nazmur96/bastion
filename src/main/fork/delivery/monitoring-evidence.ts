import { z } from 'zod'
import type { DeliveryConfig } from '../../../shared/fork-delivery/delivery-contract'
import {
  monitoringConfigSchema,
  type ConnectorHealth,
  type MonitoringAlert,
  type MonitoringConfig,
  type MonitoringEvidence
} from '../../../shared/fork-delivery/monitoring-contract'
import { prometheusGet, urlGet, type TransportDeps } from './monitoring-transport'
import { check, freshness, signals } from './monitoring-signals'

export type MonitoringDeps = TransportDeps & { readConfig: () => Promise<string | null> }
const applicationSchema = z.object({
  spec: z.object({ destination: z.object({ namespace: z.string().optional() }) })
})
const alertsSchema = z.object({
  data: z.object({
    alerts: z.array(
      z.object({
        labels: z.record(z.string(), z.string()),
        state: z.string(),
        activeAt: z.string().optional()
      })
    )
  })
})
async function grafanaHealth(
  grafana: NonNullable<MonitoringConfig['grafana']>,
  deps: TransportDeps
): Promise<ConnectorHealth> {
  const { get, tokenMissing } = urlGet(grafana.url, grafana.tokenEnv, deps)
  const base = { name: 'Grafana' as const, via: grafana.url, freshness: null }
  const health = await get('/api/health')
  if (!health.ok) {
    return {
      ...base,
      reachable: check(health.kind === 'unreachable' ? 'mismatch' : 'unknown', health.detail),
      auth: check('unknown', 'not reached')
    }
  }
  const version = z.object({ version: z.string().max(64) }).safeParse(health.body)
  const reachable = check(
    'verified',
    version.success ? `Grafana ${version.data.version}` : 'reachable'
  )
  if (!grafana.tokenEnv) {
    return { ...base, reachable, auth: check('unknown', 'no token configured · links only') }
  }
  if (tokenMissing) {
    return {
      ...base,
      reachable,
      auth: check('unknown', `${grafana.tokenEnv} is not set on the project's owner`)
    }
  }
  const search = await get('/api/search', { limit: '1' })
  return {
    ...base,
    reachable,
    auth: search.ok
      ? check('verified', 'token accepted')
      : check(search.kind === 'auth' ? 'mismatch' : 'unknown', search.detail)
  }
}

/** Read-only monitoring evidence for the application's namespace. Unknown stays unknown. */
export async function readMonitoringEvidence(
  request: DeliveryConfig,
  deps: MonitoringDeps,
  now = Date.now()
): Promise<MonitoringEvidence> {
  const evidence: MonitoringEvidence = {
    attached: false,
    namespace: null,
    connectors: [],
    signals: [],
    alerts: [],
    links: [],
    unknown: [],
    readAt: now
  }
  const text = await deps.readConfig()
  if (text === null) {
    return evidence
  }
  evidence.attached = true
  let config: MonitoringConfig
  try {
    config = monitoringConfigSchema.parse(JSON.parse(text))
  } catch {
    evidence.unknown.push('.bastion/monitoring.json is unreadable or invalid')
    return evidence
  }
  const app = await deps.kubectl([
    '-n',
    request.applicationNamespace,
    'get',
    'applications.argoproj.io',
    request.application,
    '-o',
    'json'
  ])
  const parsedApp = app.ok ? applicationSchema.safeParse(safeJson(app.out)) : null
  const ns = parsedApp?.success ? (parsedApp.data.spec.destination.namespace ?? null) : null
  evidence.namespace = ns && /^[a-z0-9]([-a-z0-9]{0,61}[a-z0-9])?$/.test(ns) ? ns : null
  if (!evidence.namespace) {
    evidence.unknown.push(`Argo CD Application: ${app.ok ? 'no destination namespace' : app.code}`)
  }
  const prometheus = prometheusGet(config.prometheus, deps)
  const build = await prometheus.get('/api/v1/status/buildinfo')
  const version = build.ok
    ? z.object({ data: z.object({ version: z.string().max(64) }) }).safeParse(build.body)
    : null
  const health: ConnectorHealth = {
    name: 'Prometheus',
    via: prometheus.via,
    reachable:
      build.ok || build.kind === 'auth'
        ? check(
            'verified',
            version?.success ? `Prometheus ${version.data.data.version}` : 'reachable'
          )
        : check(build.kind === 'unreachable' ? 'mismatch' : 'unknown', build.detail),
    auth: build.ok
      ? check(
          prometheus.tokenMissing ? 'unknown' : 'verified',
          prometheus.tokenMissing
            ? 'token variable not set on the owner; answered without it'
            : 'service' in config.prometheus
              ? 'allowed by cluster RBAC'
              : 'accepted'
        )
      : build.kind === 'auth'
        ? check('mismatch', build.detail)
        : check('unknown', 'not reached'),
    freshness: check('unknown', build.ok ? 'namespace unknown' : 'not reached')
  }
  evidence.connectors.push(health)
  const grafana = config.grafana?.url.replace(/\/+$/, '') ?? null
  if (build.ok && evidence.namespace) {
    const ns = evidence.namespace
    health.freshness = await freshness(prometheus.get, ns, now)
    const browser = prometheus.browserUrl?.replace(/\/+$/, '') ?? null
    evidence.signals = await signals(prometheus.get, ns, config.thresholds, (query) =>
      browser ? `${browser}/graph?g0.expr=${encodeURIComponent(query)}&g0.tab=0` : null
    )
    const alerts = await prometheus.get('/api/v1/alerts')
    const parsed = alerts.ok ? alertsSchema.safeParse(alerts.body) : null
    if (!parsed?.success) {
      evidence.unknown.push(`Prometheus alerts: ${alerts.ok ? 'unexpected shape' : alerts.detail}`)
    }
    evidence.alerts = (parsed?.success ? parsed.data.data.alerts : [])
      .filter(
        (alert) =>
          alert.labels.namespace === ns && (alert.state === 'firing' || alert.state === 'pending')
      )
      .slice(0, 50)
      .map((alert): MonitoringAlert => {
        const name = alert.labels.alertname ?? 'unnamed'
        return {
          name,
          state: alert.state === 'firing' ? 'firing' : 'pending',
          severity: alert.labels.severity ?? null,
          since: alert.activeAt ?? null,
          link: grafana
            ? `${grafana}/alerting/list?search=${encodeURIComponent(`label:alertname=${name}`)}`
            : browser
              ? `${browser}/alerts?search=${encodeURIComponent(name)}`
              : null
        }
      })
    if (grafana) {
      evidence.links.push({
        label: `Grafana alert rules for ${ns}`,
        url: `${grafana}/alerting/list?search=${encodeURIComponent(`label:namespace=${ns}`)}`
      })
    }
    if (browser) {
      evidence.links.push({ label: 'Prometheus alerts', url: `${browser}/alerts` })
    }
  }
  if (config.grafana) {
    evidence.connectors.push(await grafanaHealth(config.grafana, deps))
  }
  return evidence
}
function safeJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}
