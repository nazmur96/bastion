import { z } from 'zod'
import type {
  MonitoringCheck,
  MonitoringConfig,
  MonitoringSignal
} from '../../../shared/fork-delivery/monitoring-contract'
import type { MonitoringGet, MonitoringResponse } from './monitoring-transport'

type Failure = Extract<MonitoringResponse, { ok: false }>
const FRESH_SECONDS = 300
const vectorSchema = z.object({
  status: z.literal('success'),
  data: z.object({
    result: z.array(z.object({ value: z.tuple([z.number(), z.string()]) }).passthrough())
  })
})
export const check = (status: MonitoringCheck['status'], detail: string): MonitoringCheck => ({
  status,
  detail
})

/** First sample of an instant query; NaN or no series is null. */
async function scalar(get: MonitoringGet, query: string): Promise<number | null | Failure> {
  const response = await get('/api/v1/query', { query })
  if (!response.ok) {
    return response
  }
  const parsed = vectorSchema.safeParse(response.body)
  if (!parsed.success) {
    return { ok: false, kind: 'error', detail: 'unexpected query response' }
  }
  const value = Number(parsed.data.data.result[0]?.value[1])
  return Number.isFinite(value) ? value : null
}
const failed = (value: unknown): value is Failure =>
  typeof value === 'object' && value !== null && 'ok' in value

export async function signals(
  get: MonitoringGet,
  ns: string,
  thresholds: MonitoringConfig['thresholds'],
  link: (query: string) => string | null
): Promise<MonitoringSignal[]> {
  const sel = `namespace="${ns}"`
  const make = (
    id: MonitoringSignal['id'],
    label: string,
    query: string,
    status: MonitoringSignal['status'],
    detail: string
  ): MonitoringSignal => ({ id, label, query, status, detail, link: link(query) })
  const out: MonitoringSignal[] = []
  const up = `sum(up{${sel}})`
  const count = `count(up{${sel}})`
  const [upValue, countValue] = [await scalar(get, up), await scalar(get, count)]
  if (failed(upValue)) {
    out.push(make('scrape', 'Scrape targets', up, 'unknown', upValue.detail))
  } else if (failed(countValue)) {
    out.push(make('scrape', 'Scrape targets', up, 'unknown', countValue.detail))
  } else if (countValue === null) {
    out.push(make('scrape', 'Scrape targets', up, 'unknown', `no scrape targets for ${ns}`))
  } else {
    const healthy = upValue ?? 0
    out.push(
      make(
        'scrape',
        'Scrape targets',
        up,
        healthy < countValue ? 'mismatch' : 'verified',
        `${healthy}/${countValue} targets up`
      )
    )
  }
  const restarts = `sum(increase(kube_pod_container_status_restarts_total{${sel}}[1h]))`
  const restartValue = await scalar(get, restarts)
  out.push(
    failed(restartValue)
      ? make('restarts', 'Container restarts', restarts, 'unknown', restartValue.detail)
      : restartValue === null
        ? make(
            'restarts',
            'Container restarts',
            restarts,
            'unknown',
            'kube_pod_container_status_restarts_total not found (kube-state-metrics)'
          )
        : Math.round(restartValue) > 0
          ? make(
              'restarts',
              'Container restarts',
              restarts,
              'mismatch',
              `${Math.round(restartValue)} restart${Math.round(restartValue) === 1 ? '' : 's'} in the last hour`
            )
          : make(
              'restarts',
              'Container restarts',
              restarts,
              'verified',
              'no restarts in the last hour'
            )
  )
  const total = `sum(rate(http_requests_total{${sel}}[5m]))`
  const errors = `sum(rate(http_requests_total{${sel},code=~"5.."}[5m])) or sum(rate(http_requests_total{${sel},status=~"5.."}[5m]))`
  const totalValue = await scalar(get, total)
  if (failed(totalValue) || totalValue === null || totalValue === 0) {
    out.push(
      make(
        'errors',
        'HTTP 5xx ratio',
        errors,
        'unknown',
        failed(totalValue)
          ? totalValue.detail
          : totalValue === null
            ? 'http_requests_total not found'
            : 'no requests in the last 5 minutes'
      )
    )
  } else {
    const errorValue = await scalar(get, errors)
    if (failed(errorValue)) {
      out.push(make('errors', 'HTTP 5xx ratio', errors, 'unknown', errorValue.detail))
    } else {
      const ratio = (errorValue ?? 0) / totalValue
      const limit = thresholds?.errorRatio ?? 0.01
      out.push(
        make(
          'errors',
          'HTTP 5xx ratio',
          errors,
          ratio > limit ? 'mismatch' : 'verified',
          `${(ratio * 100).toFixed(2)}% 5xx over 5 minutes (limit ${(limit * 100).toFixed(2)}%)`
        )
      )
    }
  }
  const latency = `histogram_quantile(0.95, sum by (le) (rate(http_request_duration_seconds_bucket{${sel}}[5m])))`
  const latencyValue = await scalar(get, latency)
  const limitMs = thresholds?.p95Ms ?? 1000
  out.push(
    failed(latencyValue)
      ? make('latency', 'p95 latency', latency, 'unknown', latencyValue.detail)
      : latencyValue === null
        ? make(
            'latency',
            'p95 latency',
            latency,
            'unknown',
            'no http_request_duration_seconds traffic in the last 5 minutes'
          )
        : make(
            'latency',
            'p95 latency',
            latency,
            latencyValue * 1000 > limitMs ? 'mismatch' : 'verified',
            `${Math.round(latencyValue * 1000)} ms over 5 minutes (limit ${limitMs} ms)`
          )
  )
  return out
}

export async function freshness(
  get: MonitoringGet,
  ns: string,
  now: number
): Promise<MonitoringCheck> {
  const newest = await scalar(get, `max(timestamp(up{namespace="${ns}"}))`)
  if (failed(newest)) {
    return check('unknown', newest.detail)
  }
  if (newest !== null) {
    const age = Math.max(Math.round(now / 1000 - newest), 0)
    return age <= FRESH_SECONDS
      ? check('verified', `newest sample ${age} s old`)
      : check('mismatch', `newest sample ${Math.round(age / 60)} min old`)
  }
  const seen = await scalar(get, `count(last_over_time(up{namespace="${ns}"}[1h]))`)
  return !failed(seen) && seen !== null
    ? check('mismatch', 'no sample in the last 5 minutes (targets seen within 1 hour)')
    : check('unknown', `no scrape targets for ${ns}`)
}
