import { z } from 'zod'
import {
  RealAwsFailure,
  type RealAwsResources,
  type RealAwsService
} from '../../../shared/fork-cloud/real-aws-contract'
import type { RealAwsOperation } from './real-aws-operations'
export type RealAwsCall = (
  operation: RealAwsOperation,
  parameters: Record<string, unknown>
) => Promise<unknown>
const row = z.record(z.string(), z.unknown())
const text = z
  .string()
  .min(1)
  .max(2048)
  .refine((value) =>
    [...value].every(
      (character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127
    )
  )
const services: RealAwsService[] = ['tagging', 's3', 'dynamodb', 'sqs', 'lambda']
const descriptors = {
  tagging: {
    field: 'ResourceTagMappingList',
    next: 'PaginationToken',
    parameter: 'PaginationToken',
    base: { ResourcesPerPage: 100 }
  },
  s3: {
    field: 'Buckets',
    next: 'ContinuationToken',
    parameter: 'ContinuationToken',
    base: { MaxBuckets: 100 }
  },
  dynamodb: {
    field: 'TableNames',
    next: 'LastEvaluatedTableName',
    parameter: 'ExclusiveStartTableName',
    base: { Limit: 100 }
  },
  sqs: { field: 'QueueUrls', next: 'NextToken', parameter: 'NextToken', base: { MaxResults: 100 } },
  lambda: { field: 'Functions', next: 'NextMarker', parameter: 'Marker', base: { MaxItems: 100 } }
}
function project(service: RealAwsService, raw: unknown, accountId: string) {
  let name: unknown,
    arn: unknown = null
  if (service === 'dynamodb') {
    name = raw
  } else if (service === 'sqs') {
    name = text.parse(raw).split('/').at(-1)
  } else {
    const item = row.parse(raw)
    if (service === 'tagging') {
      const parsedArn = text.parse(item.ResourceARN)
      arn = parsedArn
      name = parsedArn.split(/[:/]/).at(-1)
    }
    if (service === 's3') {
      name = item.Name
      arn = `arn:aws:s3:::${text.parse(name)}`
    }
    if (service === 'lambda') {
      name = item.FunctionName
      arn = text.parse(item.FunctionArn)
    }
  }
  const checkedName = text.max(256).parse(name),
    checkedArn = arn === null ? null : text.parse(arn)
  const owner = checkedArn?.split(':')[4]
  if (owner && owner !== accountId) {
    throw new RealAwsFailure('identity-mismatch')
  }
  return { name: checkedName, arn: checkedArn }
}
async function serviceRead(
  service: RealAwsService,
  call: RealAwsCall,
  accountId: string
): Promise<RealAwsResources['results'][number]> {
  const items: { name: string; arn: string | null }[] = [],
    seen = new Set<string>(),
    descriptor = descriptors[service]
  let token: string | undefined
  try {
    for (let page = 0; page < 3; page++) {
      const response = row.parse(
        await call(service, {
          ...descriptor.base,
          ...(token ? { [descriptor.parameter]: token } : {})
        })
      )
      const values = z.array(z.unknown()).parse(response[descriptor.field])
      const limited = values.length > 500 - items.length
      items.push(
        ...values.slice(0, 500 - items.length).map((value) => project(service, value, accountId))
      )
      const next = response[descriptor.next]
      if (next === null || next === undefined || next === '') {
        return {
          service,
          status: 'ok',
          items,
          truncated: limited
        }
      }
      token = z.string().min(1).max(4096).parse(next)
      if (seen.has(token) || items.length >= 500) {
        return { service, status: 'ok', items, truncated: true }
      }
      seen.add(token)
    }
    return { service, status: 'ok', items, truncated: true }
  } catch (error) {
    if (
      error instanceof RealAwsFailure &&
      [
        'cli-session-expired',
        'service-token-expired',
        'auth-unavailable',
        'identity-mismatch',
        'owner-changed',
        'tool-unavailable'
      ].includes(error.code)
    ) {
      throw error
    }
    return {
      service,
      status: error instanceof RealAwsFailure ? error.code : 'unreadable',
      items,
      truncated: items.length > 0
    }
  }
}
export async function listRealAwsResources(
  call: RealAwsCall,
  accountId: string
): Promise<RealAwsResources> {
  const results: RealAwsResources['results'] = []
  for (let index = 0; index < services.length; index += 2) {
    const batch = await Promise.allSettled(
      services.slice(index, index + 2).map((service) => serviceRead(service, call, accountId))
    )
    for (const item of batch) {
      if (item.status === 'rejected') {
        throw item.reason
      }
      results.push(item.value)
    }
  }
  return { at: Date.now(), results }
}
