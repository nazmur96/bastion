import { request } from 'node:http'
import { z } from 'zod'
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

type HttpRequest = {
  method: 'GET' | 'POST'
  path: string
  headers: Record<string, string>
  body?: string
}
type HttpResponse = { status: number; body: string }
export type FlociHttp = (port: number, req: HttpRequest, timeoutMs: number) => Promise<HttpResponse>
type Page = { items: FlociResourceItem[]; next: string | null }
type Operation = { build: (token: string | null) => HttpRequest; parse: (body: string) => Page }

class ListingFailure extends Error {
  constructor(readonly status: FlociServiceStatus) {
    super(status)
  }
}

function clean(value: unknown, max: number): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= max
    ? [...value]
        .filter((character) => {
          const code = character.charCodeAt(0)
          return code >= 32 && code !== 127
        })
        .join('')
    : null
}
function item(name: unknown, arn: unknown = null): FlociResourceItem | null {
  const n = clean(name, 256)
  return n ? { name: n, arn: clean(arn, 2048) } : null
}
function items(values: (FlociResourceItem | null)[]): FlociResourceItem[] {
  return values.filter((value): value is FlociResourceItem => value !== null)
}
function json(body: string): Record<string, unknown> {
  const parsed = z.record(z.string(), z.unknown()).safeParse(JSON.parse(body))
  if (!parsed.success) {
    throw new ListingFailure('invalid')
  }
  return parsed.data
}
function list(value: unknown): unknown[] {
  if (value === undefined) {
    return []
  }
  if (!Array.isArray(value)) {
    throw new ListingFailure('invalid')
  }
  return value
}
function token(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= 4096 ? value : null
}
function xmlText(value: string): string {
  return value
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&amp;', '&')
}
function awsJson(target: string, version: '1.0' | '1.1', body: Record<string, string>) {
  return {
    method: 'POST' as const,
    path: '/',
    headers: { 'Content-Type': `application/x-amz-json-${version}`, 'X-Amz-Target': target },
    body: JSON.stringify(body)
  }
}

// Fixed read-only operations: the method, path and body are built here, never by a caller.
const OPERATIONS: Record<FlociResourceService, Operation> = {
  tagging: {
    build: (next) =>
      awsJson(
        'ResourceGroupsTaggingAPI_20170126.GetResources',
        '1.1',
        next ? { PaginationToken: next } : {}
      ),
    parse: (body) => {
      const value = json(body)
      return {
        // Tag values can hold anything; only the resource identity is kept.
        items: items(
          list(value.ResourceTagMappingList).map((entry) => {
            const arn =
              entry && typeof entry === 'object' ? Reflect.get(entry, 'ResourceARN') : null
            return item(typeof arn === 'string' ? arn.split(/[:/]/).at(-1) : null, arn)
          })
        ),
        next: token(value.PaginationToken)
      }
    }
  },
  s3: {
    build: () => ({ method: 'GET', path: '/', headers: {} }),
    parse: (body) => {
      if (!body.includes('ListAllMyBucketsResult')) {
        throw new ListingFailure('invalid')
      }
      const names = [...body.matchAll(/<Bucket>[\s\S]*?<Name>([^<]{1,255})<\/Name>/g)].map(
        (match) => xmlText(match[1])
      )
      return { items: items(names.map((name) => item(name, `arn:aws:s3:::${name}`))), next: null }
    }
  },
  dynamodb: {
    build: (next) =>
      awsJson('DynamoDB_20120810.ListTables', '1.0', next ? { ExclusiveStartTableName: next } : {}),
    parse: (body) => {
      const value = json(body)
      return {
        items: items(list(value.TableNames).map((name) => item(name))),
        next: token(value.LastEvaluatedTableName)
      }
    }
  },
  sqs: {
    build: (next) => awsJson('AmazonSQS.ListQueues', '1.0', next ? { NextToken: next } : {}),
    parse: (body) => {
      const value = json(body)
      return {
        items: items(
          list(value.QueueUrls).map((url) =>
            item(typeof url === 'string' ? url.split('/').at(-1) : null)
          )
        ),
        next: token(value.NextToken)
      }
    }
  },
  lambda: {
    build: (next) => ({
      method: 'GET',
      path: `/2015-03-31/functions/?MaxItems=50${next ? `&Marker=${encodeURIComponent(next)}` : ''}`,
      headers: {}
    }),
    parse: (body) => {
      const value = json(body)
      return {
        // Function environment and configuration are dropped.
        items: items(
          list(value.Functions).map((fn) =>
            fn && typeof fn === 'object'
              ? item(Reflect.get(fn, 'FunctionName'), Reflect.get(fn, 'FunctionArn'))
              : null
          )
        ),
        next: token(value.NextMarker)
      }
    }
  }
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
  deadline: number
): Promise<FlociServiceResult> {
  const operation = OPERATIONS[service]
  const found: FlociResourceItem[] = []
  const seen = new Set<string>()
  let next: string | null = null
  try {
    for (let page = 0; page < PAGE_LIMIT; page++) {
      const remaining = deadline - Date.now()
      if (remaining <= 0) {
        return { service, status: 'timeout', items: found, truncated: true }
      }
      const response = await http(port, operation.build(next), Math.min(REQUEST_MS, remaining))
      const failure = statusFor(response)
      if (failure) {
        return { service, status: failure, items: found, truncated: found.length > 0 }
      }
      const parsed = operation.parse(response.body)
      found.push(...parsed.items.slice(0, ITEM_LIMIT - found.length))
      if (!parsed.next) {
        return { service, status: 'ok', items: found, truncated: false }
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
    const status =
      error instanceof ListingFailure
        ? error.status
        : error instanceof SyntaxError
          ? 'invalid'
          : 'error'
    return { service, status, items: found, truncated: found.length > 0 }
  }
}

/** Loopback-only request to the admitted emulator port, bounded in time and size. */
export const flociHttp: FlociHttp = (port, req, timeoutMs) =>
  new Promise((resolve, reject) => {
    const outgoing = request(
      {
        hostname: '127.0.0.1',
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
          resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') })
        )
        res.on('error', reject)
      }
    )
    outgoing.setTimeout(timeoutMs, () => outgoing.destroy(new ListingFailure('timeout')))
    outgoing.on('error', reject)
    outgoing.end(req.body)
  })

export async function listFlociResources(
  port: number,
  http: FlociHttp = flociHttp,
  now: () => number = Date.now
): Promise<FlociResources> {
  const deadline = now() + OVERALL_MS
  const results: FlociServiceResult[] = []
  for (let index = 0; index < FLOCI_RESOURCE_SERVICES.length; index += CONCURRENCY) {
    const batch = FLOCI_RESOURCE_SERVICES.slice(index, index + CONCURRENCY)
    results.push(
      ...(await Promise.all(batch.map((service) => listService(service, port, http, deadline))))
    )
  }
  return { at: now(), results }
}
