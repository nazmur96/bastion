import { describe, expect, it } from 'vitest'
import { listFlociResources, type FlociHttp } from './floci-resources'

type Reply = { status: number; body: string } | Error
function fakeHttp(routes: Record<string, Reply | Reply[]>) {
  const calls: { method: string; path: string; target?: string; body?: string }[] = []
  const http: FlociHttp = async (port, req) => {
    expect(port).toBe(14566)
    const target = req.headers['X-Amz-Target']
    calls.push({ method: req.method, path: req.path, target, body: req.body })
    const key = target ?? `${req.method} ${req.path.split('?')[0]}`
    const route = routes[key]
    const reply = Array.isArray(route) ? (route.shift() ?? { status: 500, body: '' }) : route
    if (!reply) {
      return { status: 404, body: '' }
    }
    if (reply instanceof Error) {
      throw reply
    }
    return reply
  }
  return { http, calls }
}
const ok = (body: unknown) => ({ status: 200, body: JSON.stringify(body) })
const empty = {
  'ResourceGroupsTaggingAPI_20170126.GetResources': ok({ ResourceTagMappingList: [] }),
  'GET /': {
    status: 200,
    body: '<ListAllMyBucketsResult><Buckets></Buckets></ListAllMyBucketsResult>'
  },
  'DynamoDB_20120810.ListTables': ok({ TableNames: [] }),
  'AmazonSQS.ListQueues': ok({ QueueUrls: [] }),
  'GET /2015-03-31/functions/': ok({ Functions: [] })
}
const byService = (resources: Awaited<ReturnType<typeof listFlociResources>>) =>
  Object.fromEntries(resources.results.map((result) => [result.service, result]))

describe('Floci read-only resource listers', () => {
  it('lists each fixed service with projected names and no secret-bearing fields', async () => {
    const { http, calls } = fakeHttp({
      ...empty,
      'ResourceGroupsTaggingAPI_20170126.GetResources': ok({
        ResourceTagMappingList: [
          {
            ResourceARN: 'arn:aws:sqs:us-east-1:000000000000:orders',
            Tags: [{ Key: 'token', Value: 'SECRET-TAG-VALUE' }]
          }
        ]
      }),
      'GET /': {
        status: 200,
        body: '<ListAllMyBucketsResult><Buckets><Bucket><Name>logs&amp;audit</Name></Bucket></Buckets></ListAllMyBucketsResult>'
      },
      'GET /2015-03-31/functions/': ok({
        Functions: [
          {
            FunctionName: 'resize',
            FunctionArn: 'arn:aws:lambda:us-east-1:000000000000:function:resize',
            Environment: { Variables: { DB_PASSWORD: 'SECRET-LAMBDA-ENV' } }
          }
        ]
      })
    })
    const resources = await listFlociResources(14566, http)
    const results = byService(resources)
    expect(results.tagging.items).toEqual([
      { name: 'orders', arn: 'arn:aws:sqs:us-east-1:000000000000:orders' }
    ])
    expect(results.s3.items[0].name).toBe('logs&audit')
    expect(results.lambda.items).toEqual([
      { name: 'resize', arn: 'arn:aws:lambda:us-east-1:000000000000:function:resize' }
    ])
    expect(JSON.stringify(resources)).not.toMatch(/SECRET-TAG-VALUE|SECRET-LAMBDA-ENV/)
    // Only the fixed read operations are sent; no caller-provided method, path or body.
    expect(new Set(calls.map((call) => call.target ?? `${call.method} ${call.path}`))).toEqual(
      new Set([
        'ResourceGroupsTaggingAPI_20170126.GetResources',
        'GET /',
        'DynamoDB_20120810.ListTables',
        'AmazonSQS.ListQueues',
        'GET /2015-03-31/functions/?MaxItems=50'
      ])
    )
    expect(calls.every((call) => call.method === 'GET' || call.body === '{}')).toBe(true)
  })

  it('follows pages within limits and stops on a repeated token', async () => {
    const { http, calls } = fakeHttp({
      ...empty,
      'DynamoDB_20120810.ListTables': [
        ok({ TableNames: ['a'], LastEvaluatedTableName: 'a' }),
        ok({ TableNames: ['b'] })
      ],
      'AmazonSQS.ListQueues': [
        ok({ QueueUrls: ['http://127.0.0.1/000000000000/q1'], NextToken: 'same' }),
        ok({ QueueUrls: ['http://127.0.0.1/000000000000/q2'], NextToken: 'same' })
      ]
    })
    const results = byService(await listFlociResources(14566, http))
    expect(results.dynamodb).toMatchObject({ status: 'ok', truncated: false })
    expect(results.dynamodb.items.map((item) => item.name)).toEqual(['a', 'b'])
    expect(results.sqs).toMatchObject({ status: 'ok', truncated: true })
    expect(results.sqs.items.map((item) => item.name)).toEqual(['q1', 'q2'])
    expect(calls.filter((call) => call.target === 'AmazonSQS.ListQueues')).toHaveLength(2)
  })

  it('reports each failing service on its own without erasing the others', async () => {
    const { http } = fakeHttp({
      ...empty,
      'DynamoDB_20120810.ListTables': { status: 403, body: 'AccessDenied' },
      'AmazonSQS.ListQueues': { status: 501, body: 'not implemented' },
      'GET /2015-03-31/functions/': { status: 200, body: '{not json' },
      'ResourceGroupsTaggingAPI_20170126.GetResources': new Error('socket hang up')
    })
    const results = byService(await listFlociResources(14566, http))
    expect(results.dynamodb.status).toBe('denied')
    expect(results.sqs.status).toBe('unimplemented')
    expect(results.lambda.status).toBe('invalid')
    expect(results.tagging.status).toBe('error')
    expect(results.s3.status).toBe('ok')
  })

  it('caps items per service', async () => {
    const many = Array.from({ length: 300 }, (_, index) => `t${index}`)
    const { http } = fakeHttp({
      ...empty,
      'DynamoDB_20120810.ListTables': [
        ok({ TableNames: many, LastEvaluatedTableName: 'p1' }),
        ok({ TableNames: many, LastEvaluatedTableName: 'p2' })
      ]
    })
    const results = byService(await listFlociResources(14566, http))
    expect(results.dynamodb.items).toHaveLength(500)
    expect(results.dynamodb.truncated).toBe(true)
  })
})
