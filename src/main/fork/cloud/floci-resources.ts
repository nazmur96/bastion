import { request } from 'node:http'
import { z } from 'zod'
import { FlociFailure } from '../../../shared/fork-cloud/floci-contract'
import type { FlociProvider } from '../../../shared/fork-cloud/floci-products'
import {
  AWS_OPERATIONS,
  ListingFailure,
  type FlociHttp,
  type HttpResponse,
  type Operation
} from './floci-listing-operations'
import { PROVIDER_OPERATIONS, PROVIDER_SERVICES } from './floci-provider-operations'
export type { FlociHttp } from './floci-listing-operations'
import {
  FLOCI_RESOURCE_SERVICES,
  type FlociResourceItem,
  type FlociResourceService,
  type FlociResources,
  type FlociServiceResult,
  type FlociServiceStatus
} from '../../../shared/fork-cloud/floci-resources-contract'

const PAGE_LIMIT = 3
const ITEM_LIMIT = 500
const REQUEST_MS = 5_000
const OVERALL_MS = 30_000
const RESPONSE_BYTES = 1024 * 1024
const CONCURRENCY = 2
const OPERATIONS: Record<FlociResourceService, Operation> = {
  ...AWS_OPERATIONS,
  ...PROVIDER_OPERATIONS
}

function statusFor(response: HttpResponse): FlociServiceStatus | null {
  if (response.status >= 200 && response.status < 300) {
    return null
  }
  if (response.status === 401 || response.status === 403) {
    return 'denied'
  }
  if (
    response.status === 404 ||
    response.status === 501 ||
    /UnknownOperation|not implemented|NotImplemented/i.test(response.body.slice(0, 2000))
  ) {
    return 'unimplemented'
  }
  return 'error'
}

async function listService(
  service: FlociResourceService,
  port: number,
  http: FlociHttp,
  deadline: number,
  now: () => number,
  assertCurrent: () => void,
  provider: FlociProvider
): Promise<FlociServiceResult> {
  const operation = OPERATIONS[service]
  const found: FlociResourceItem[] = []
  const seen = new Set<string>()
  let next: string | null = null
  try {
    for (let page = 0; page < PAGE_LIMIT; page++) {
      assertCurrent()
      const remaining = deadline - now()
      if (remaining <= 0) {
        return { service, status: 'timeout', items: found, truncated: true }
      }
      const response = await http(port, operation.build(next), Math.min(REQUEST_MS, remaining))
      assertCurrent()
      const failure = statusFor(response)
      if (failure) {
        return { service, status: failure, items: found, truncated: found.length > 0 }
      }
      const parsed = operation.parse(response.body, response.headers)
      const overflow = parsed.items.length > ITEM_LIMIT - found.length
      found.push(...parsed.items.slice(0, ITEM_LIMIT - found.length))
      if (!parsed.next) {
        return { service, status: 'ok', items: found, truncated: provider !== 'aws' && overflow }
      }
      // A repeated token would loop forever; stop with what was listed.
      if (seen.has(parsed.next) || found.length >= ITEM_LIMIT) {
        return { service, status: 'ok', items: found, truncated: true }
      }
      seen.add(parsed.next)
      next = parsed.next
    }
    return { service, status: 'ok', items: found, truncated: true }
  } catch (error) {
    if (error instanceof FlociFailure) {
      throw error
    }
    const status =
      error instanceof ListingFailure
        ? error.status
        : error instanceof SyntaxError || error instanceof z.ZodError
          ? 'invalid'
          : 'error'
    return {
      service,
      status,
      items: found,
      truncated: found.length > 0 || (error instanceof ListingFailure && error.incomplete)
    }
  }
}

/** Loopback-only request to the admitted emulator port, bounded in time and size. */
export const flociHttp: FlociHttp = (port, req, timeoutMs) =>
  new Promise((resolve, reject) => {
    const outgoing = request(
      {
        hostname: '127.0.0.1',
        maxHeaderSize: 8192,
        port,
        path: req.path,
        method: req.method,
        headers: {
          ...req.headers,
          ...(req.body ? { 'Content-Length': Buffer.byteLength(req.body) } : {})
        },
        agent: false
      },
      (res) => {
        const chunks: Buffer[] = []
        let size = 0
        res.on('data', (chunk: Buffer) => {
          size += chunk.length
          if (size > RESPONSE_BYTES) {
            outgoing.destroy(new ListingFailure('too-large'))
            return
          }
          chunks.push(chunk)
        })
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf8'),
            headers:
              typeof res.headers['opc-next-page'] === 'string'
                ? { 'opc-next-page': res.headers['opc-next-page'] }
                : {}
          })
        )
        res.on('error', reject)
      }
    )
    const deadline = setTimeout(() => outgoing.destroy(new ListingFailure('timeout')), timeoutMs)
    outgoing.once('close', () => clearTimeout(deadline))
    outgoing.on('error', reject)
    outgoing.end(req.body)
  })

export async function listFlociResources(
  port: number,
  http: FlociHttp = flociHttp,
  now: () => number = Date.now,
  options: { provider?: FlociProvider; assertCurrent?: () => void } = {}
): Promise<FlociResources> {
  const parsedProvider = z.enum(['aws', 'azure', 'gcp', 'oci']).safeParse(options.provider ?? 'aws')
  if (!parsedProvider.success) {
    throw new FlociFailure('invalid')
  }
  const provider = parsedProvider.data
  const services = provider === 'aws' ? FLOCI_RESOURCE_SERVICES : PROVIDER_SERVICES[provider]
  const assertCurrent = options.assertCurrent ?? (() => {})
  assertCurrent()
  const deadline = now() + OVERALL_MS
  const results: FlociServiceResult[] = []
  for (let index = 0; index < services.length; index += CONCURRENCY) {
    const batch = services.slice(index, index + CONCURRENCY)
    const settled = await Promise.allSettled(
      batch.map((service) =>
        listService(service, port, http, deadline, now, assertCurrent, provider)
      )
    )
    for (const result of settled) {
      if (result.status === 'rejected') {
        throw result.reason
      }
      results.push(result.value)
    }
  }
  assertCurrent()
  return { ...(provider === 'aws' ? {} : { provider }), at: now(), results }
}
