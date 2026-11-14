import { z } from 'zod'
import { RealAwsFailure, type RealAwsBudgets } from '../../../shared/fork-cloud/real-aws-contract'
import type { RealAwsCall } from './real-aws-resources'
const object = z.record(z.string(), z.unknown())
export async function readRealAwsBudgets(
  call: RealAwsCall,
  accountId: string
): Promise<RealAwsBudgets> {
  const result: RealAwsBudgets = {
    at: Date.now(),
    status: 'unknown',
    accountWide: false,
    alerts: 0,
    subscriberTypes: [],
    truncated: false
  }
  let calls = 0
  async function read(
    operation: 'budgets' | 'notifications' | 'subscribers',
    parameters: Record<string, unknown>
  ) {
    if (++calls > 20) {
      result.truncated = true
      throw new RealAwsFailure('too-large')
    }
    const value = object.parse(
      await call(operation, { AccountId: accountId, MaxResults: 20, ...parameters })
    )
    if (value.NextToken) {
      result.truncated = true
    }
    return value
  }
  try {
    const listed = await read('budgets', {}),
      budgets = z.array(object).parse(listed.Budgets)
    result.status = budgets.length ? 'present' : result.truncated ? 'unknown' : 'absent'
    if (budgets.length > 20) {
      result.truncated = true
    }
    for (const budget of budgets.slice(0, 20)) {
      const BudgetName = z.string().min(1).max(100).parse(budget.BudgetName)
      const filters =
        budget.CostFilters === null || budget.CostFilters === undefined
          ? {}
          : object.parse(budget.CostFilters)
      const notifications = await read('notifications', { BudgetName })
      const entries = z.array(object).parse(notifications.Notifications)
      if (entries.length > 20) {
        result.truncated = true
      }
      for (const Notification of entries.slice(0, 20)) {
        const subscribers = await read('subscribers', { BudgetName, Notification })
        const types = z
          .array(z.object({ SubscriptionType: z.enum(['EMAIL', 'SNS']) }))
          .parse(subscribers.Subscribers)
        if (types.length) {
          result.alerts++
          if (!Object.keys(filters).length) {
            result.accountWide = true
          }
        }
        result.subscriberTypes = [
          ...new Set([...result.subscriberTypes, ...types.map((item) => item.SubscriptionType)])
        ]
      }
    }
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
    result.status = 'unknown'
    result.truncated = true
  }
  if (result.truncated) {
    result.accountWide = false
  }
  return result
}
