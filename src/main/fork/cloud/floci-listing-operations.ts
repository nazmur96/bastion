import { z } from 'zod'
import type {
  FLOCI_RESOURCE_SERVICES,
  FlociResourceItem,
  FlociServiceStatus
} from '../../../shared/fork-cloud/floci-resources-contract'
export type HttpRequest = {
  method: 'GET' | 'POST'
  path: string
  headers: Record<string, string>
  body?: string
}
export type HttpResponse = { status: number; body: string; headers?: Record<string, string> }
export type FlociHttp = (port: number, req: HttpRequest, timeoutMs: number) => Promise<HttpResponse>
export type Page = { items: FlociResourceItem[]; next: string | null }
export type Operation = {
  build: (token: string | null) => HttpRequest
  parse: (body: string, headers?: Record<string, string>) => Page
}

export class ListingFailure extends Error {
  constructor(
    readonly status: FlociServiceStatus,
    readonly incomplete = false
  ) {
    super(status)
  }
}

export function clean(value: unknown, max: number): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= max
    ? [...value]
        .filter((character) => {
          const code = character.charCodeAt(0)
          return code >= 32 && code !== 127
        })
        .join('')
    : null
}
export function item(name: unknown, arn: unknown = null): FlociResourceItem | null {
  const n = clean(name, 256)
  return n ? { name: n, arn: clean(arn, 2048) } : null
}
export function items(values: (FlociResourceItem | null)[]): FlociResourceItem[] {
  return values.filter((value): value is FlociResourceItem => value !== null)
}
export function json(body: string): Record<string, unknown> {
  const parsed = z.record(z.string(), z.unknown()).safeParse(JSON.parse(body))
  if (!parsed.success) {
    throw new ListingFailure('invalid')
  }
  return parsed.data
}
export function list(value: unknown): unknown[] {
  if (value === undefined) {
    return []
  }
  if (!Array.isArray(value)) {
    throw new ListingFailure('invalid')
  }
  return value
}
export function token(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= 4096 ? value : null
}
export function xmlText(value: string): string {
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
export const AWS_OPERATIONS: Record<(typeof FLOCI_RESOURCE_SERVICES)[number], Operation> = {
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
