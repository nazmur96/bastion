import { z } from 'zod'

/**
 * Fork: Step 14.2 monitoring connectors. A project attaches an existing Prometheus (and optionally
 * a Grafana) in a committed `.bastion/monitoring.json`. Bastion never installs a monitoring stack
 * and never stores a token: `tokenEnv` names an environment variable read on the owner per call.
 */
export const MONITORING_CONFIG_PATH = '.bastion/monitoring.json'
const label = z.string().regex(/^[a-z0-9]([-a-z0-9]{0,61}[a-z0-9])?$/)
const tokenEnv = z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/)
/** https anywhere; plain http only on loopback (a port-forward). No credentials in the URL. */
export const monitoringUrl = z
  .string()
  .max(2048)
  .url()
  .refine((value) => {
    const url = new URL(value)
    const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    return (
      (url.protocol === 'https:' || (url.protocol === 'http:' && loopback)) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
    )
  }, 'https, or http on loopback, without credentials or query')
export const monitoringConfigSchema = z
  .object({
    version: z.literal(1),
    prometheus: z.union([
      z
        .object({
          service: z
            .object({ namespace: label, name: label, port: z.number().int().min(1).max(65535) })
            .strict()
        })
        .strict(),
      z.object({ url: monitoringUrl, tokenEnv: tokenEnv.optional() }).strict()
    ]),
    grafana: z.object({ url: monitoringUrl, tokenEnv: tokenEnv.optional() }).strict().optional(),
    thresholds: z
      .object({
        errorRatio: z.number().min(0).max(1).optional(),
        p95Ms: z.number().int().min(1).max(600000).optional()
      })
      .strict()
      .optional()
  })
  .strict()
export type MonitoringConfig = z.infer<typeof monitoringConfigSchema>

export type MonitoringStatus = 'verified' | 'mismatch' | 'unknown'
export type MonitoringCheck = { status: MonitoringStatus; detail: string }
export type ConnectorHealth = {
  name: 'Prometheus' | 'Grafana'
  via: string
  reachable: MonitoringCheck
  auth: MonitoringCheck
  /** Age of the newest sample for the namespace; Grafana has none. */
  freshness: MonitoringCheck | null
}
export type MonitoringSignal = {
  id: 'scrape' | 'restarts' | 'errors' | 'latency'
  label: string
  status: MonitoringStatus
  detail: string
  /** The exact query, so the engineer can run it themselves. */
  query: string
  link: string | null
}
export type MonitoringAlert = {
  name: string
  state: 'firing' | 'pending'
  severity: string | null
  since: string | null
  link: string | null
}
export type MonitoringEvidence = {
  /** False when the project has no monitoring.json: nothing is attached. */
  attached: boolean
  namespace: string | null
  connectors: ConnectorHealth[]
  signals: MonitoringSignal[]
  alerts: MonitoringAlert[]
  links: { label: string; url: string }[]
  unknown: string[]
  readAt: number
}
