import { describe, expect, it } from 'vitest'
import { listRealAwsResources, type RealAwsCall } from './real-aws-resources'
import { readRealAwsBudgets } from './real-aws-budgets'
const empty: Record<string, unknown> = {
  tagging: { ResourceTagMappingList: [] },
  s3: { Buckets: [] },
  dynamodb: { TableNames: [] },
  sqs: { QueueUrls: [] },
  lambda: { Functions: [] }
}
describe('real read-only projections and limits', () => {
  it('drops tag values and Lambda configuration, bounds repeated pagination and keeps independent results', async () => {
    const calls: string[] = []
    const call: RealAwsCall = async (operation) => {
      calls.push(operation)
      if (operation === 'lambda') {
        return {
          Functions: [
            {
              FunctionName: 'fixture',
              FunctionArn: 'arn:aws:lambda:us-east-1:000000000000:function:fixture',
              Environment: { Variables: { SECRET: 'PLANTED_PRIVATE_VALUE' } }
            }
          ],
          NextMarker: 'same'
        }
      }
      if (operation === 'tagging') {
        return {
          ResourceTagMappingList: [
            {
              ResourceARN: 'arn:aws:sqs:us-east-1:000000000000:fixture',
              Tags: [{ Value: 'PLANTED_TAG' }]
            }
          ]
        }
      }
      return empty[operation]
    }
    const result = await listRealAwsResources(call, '000000000000')
    expect(JSON.stringify(result)).not.toMatch(/PLANTED|Environment|Tags/)
    expect(result.results.find((item) => item.service === 'lambda')?.truncated).toBe(true)
    expect(calls.filter((id) => id === 'lambda')).toHaveLength(2)
  })
  it('does not interpret a budget name as an argument or expose subscriber addresses', async () => {
    const call: RealAwsCall = async (operation, parameters) => {
      if (operation === 'budgets') {
        return { Budgets: [{ BudgetName: 'file://fixture', CostFilters: {} }] }
      }
      expect(parameters.BudgetName).toBe('file://fixture')
      if (operation === 'notifications') {
        return {
          Notifications: [
            { NotificationType: 'ACTUAL', ComparisonOperator: 'GREATER_THAN', Threshold: 80 }
          ]
        }
      }
      return { Subscribers: [{ SubscriptionType: 'EMAIL', Address: 'PLANTED_PRIVATE_ADDRESS' }] }
    }
    const result = await readRealAwsBudgets(call, '000000000000')
    expect(result).toMatchObject({
      status: 'present',
      accountWide: true,
      alerts: 1,
      subscriberTypes: ['EMAIL']
    })
    expect(JSON.stringify(result)).not.toContain('PLANTED')
  })
  it('distinguishes empty budgets from unreadable or limited evidence', async () => {
    expect(await readRealAwsBudgets(async () => ({ Budgets: [] }), '000000000000')).toMatchObject({
      status: 'absent'
    })
    expect(
      await readRealAwsBudgets(async () => ({ Budgets: [], NextToken: 'more' }), '000000000000')
    ).toMatchObject({ status: 'unknown', truncated: true, accountWide: false })
    expect(await readRealAwsBudgets(async () => ({}), '000000000000')).toMatchObject({
      status: 'unknown'
    })
  })
})
it('reports item-cap truncation when the final page has no continuation token', async () => {
  let pages = 0
  const call: RealAwsCall = async (operation) =>
    operation === 'dynamodb'
      ? {
          TableNames: Array.from({ length: 300 }, (_, index) => `fixture-${index}`),
          ...(pages++ === 0 ? { LastEvaluatedTableName: 'more' } : {})
        }
      : empty[operation]
  const result = (await listRealAwsResources(call, '000000000000')).results.find(
    (result) => result.service === 'dynamodb'
  )
  expect(result?.items).toHaveLength(500)
  expect(result?.truncated).toBe(true)
})
