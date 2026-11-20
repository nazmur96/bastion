import { z } from 'zod'
import type { MonitoringConfig } from '../../../shared/fork-delivery/monitoring-contract'
import type { DeliveryDeps } from './delivery-chain'

export type MonitoringResponse =
  | { ok: true; body: unknown }
  | { ok: false; kind: 'unreachable' | 'auth' | 'error'; detail: string }
/** One GET to a monitoring API path; never a write. */
export type MonitoringGet = (
  path: string,
  params?: Record<string, string>
) => Promise<MonitoringResponse>
export type MonitoringHttp = (
  url: string,
  headers: Record<string, string>
) => Promise<{ status: number; body: string }>
export type TransportDeps = Pick<DeliveryDeps, 'kubectl'> & {
  http: MonitoringHttp
  env: Record<string, string | undefined>
}
const MAX_BODY = 2 * 1024 * 1024

function json(text: string): MonitoringResponse {
  try {
    return { ok: true, body: JSON.parse(text) }
  } catch {
    return { ok: false, kind: 'error', detail: 'response is not JSON' }
  }
}
function query(params: Record<string, string> | undefined): string {
  const search = new URLSearchParams(params ?? {}).toString()
  return search ? `?${search}` : ''
}

/** Through the Kubernetes API service proxy with the project's pinned kubectl context. */
function serviceGet(
  service: { namespace: string; name: string; port: number },
  kubectl: TransportDeps['kubectl']
): MonitoringGet {
  return async (path, params) => {
    const result = await kubectl([
      'get',
      '--raw',
      `/api/v1/namespaces/${service.namespace}/services/${service.name}:${service.port}/proxy${path}${query(params)}`
    ])
    if (result.ok) {
      return json(result.out)
    }
    if (/Forbidden|Unauthorized|\(403\)|\(401\)/.test(result.out)) {
      return { ok: false, kind: 'auth', detail: 'the cluster refused the service proxy (RBAC)' }
    }
    if (
      /no endpoints available|connection refused|NotFound|not found|dial tcp|i\/o timeout|ServiceUnavailable/.test(
        result.out
      ) ||
      result.code !== 'failed'
    ) {
      return {
        ok: false,
        kind: 'unreachable',
        detail: result.code === 'failed' ? 'service not reachable through the cluster' : result.code
      }
    }
    return { ok: false, kind: 'error', detail: 'the request was rejected' }
  }
}

/** Direct https (or loopback http) with an optional bearer token read from the owner's env. */
export function urlGet(
  base: string,
  tokenEnv: string | undefined,
  deps: Pick<TransportDeps, 'http' | 'env'>
): { get: MonitoringGet; tokenMissing: boolean } {
  const token = tokenEnv ? deps.env[tokenEnv] : undefined
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (token) {
    headers.Authorization = `Bearer ${token}`
  }
  const root = base.replace(/\/+$/, '')
  return {
    tokenMissing: Boolean(tokenEnv && !token),
    get: async (path, params) => {
      let response: { status: number; body: string }
      try {
        response = await deps.http(`${root}${path}${query(params)}`, headers)
      } catch (error) {
        const cause = z.object({ cause: z.object({ code: z.string().max(64) }) }).safeParse(error)
          .data?.cause.code
        return {
          ok: false,
          kind: 'unreachable',
          detail: cause ?? 'connection failed'
        }
      }
      if (response.status === 401 || response.status === 403) {
        return { ok: false, kind: 'auth', detail: `rejected (${response.status})` }
      }
      if (response.status < 200 || response.status >= 300) {
        return { ok: false, kind: 'error', detail: `HTTP ${response.status}` }
      }
      return json(response.body)
    }
  }
}

export function prometheusGet(
  config: MonitoringConfig['prometheus'],
  deps: TransportDeps
): { get: MonitoringGet; via: string; tokenMissing: boolean; browserUrl: string | null } {
  if ('service' in config) {
    const { namespace, name, port } = config.service
    return {
      get: serviceGet(config.service, deps.kubectl),
      via: `cluster service ${namespace}/${name}:${port}`,
      tokenMissing: false,
      browserUrl: null
    }
  }
  return { ...urlGet(config.url, config.tokenEnv, deps), via: config.url, browserUrl: config.url }
}

/** The real HTTP client: 5 s timeout, no redirects (a token never follows one), bounded body. */
export const fetchMonitoring: MonitoringHttp = async (url, headers) => {
  const response = await fetch(url, {
    headers,
    redirect: 'error',
    signal: AbortSignal.timeout(5000)
  })
  const body = await response.text()
  return { status: response.status, body: body.length > MAX_BODY ? '' : body }
}
