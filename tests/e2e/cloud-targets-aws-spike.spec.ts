import { execFile } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { expect, test } from '@playwright/test'
import { z } from 'zod'

const execute = promisify(execFile)

test('9.0 explicitly authorized real AWS identity and budget-alert read-only probe', async () => {
  test.skip(
    process.env.ORCA_AWS_SPIKE !== '1',
    'Requires an engineer-renewed CLI session and explicit opt-in.'
  )
  const profile = process.env.ORCA_AWS_SPIKE_PROFILE
  const expectedAccount = process.env.ORCA_AWS_SPIKE_ACCOUNT
  expect(profile).toBeTruthy()
  expect(expectedAccount).toMatch(/^\d{12}$/)
  async function read(...operation: string[]): Promise<unknown> {
    const { stdout } = await execute(
      'docker',
      [
        'run',
        '--rm',
        '--label',
        'bastion.validation=step9-spike-aws',
        '-v',
        `${path.join(homedir(), '.aws')}:/root/.aws:ro`,
        '-e',
        `AWS_PROFILE=${profile}`,
        '-e',
        `AWS_REGION=${process.env.ORCA_AWS_SPIKE_REGION ?? 'us-east-1'}`,
        '-e',
        'AWS_EC2_METADATA_DISABLED=true',
        'public.ecr.aws/aws-cli/aws-cli:2.40.0',
        ...operation,
        '--output',
        'json'
      ],
      { timeout: 60_000, maxBuffer: 1_000_000 }
    )
    return JSON.parse(stdout)
  }
  const identity = await read('sts', 'get-caller-identity')
  expect(identity).toHaveProperty('Account', expectedAccount)
  const budgets = z
    .object({
      Budgets: z.array(
        z.object({
          BudgetName: z.string(),
          BudgetType: z.string(),
          TimeUnit: z.string(),
          BudgetLimit: z.object({ Amount: z.string(), Unit: z.string() }),
          CostFilters: z.record(z.string(), z.unknown()).optional()
        })
      )
    })
    .parse(await read('budgets', 'describe-budgets', '--account-id', expectedAccount ?? ''))
  const evidence = []
  for (const budget of budgets.Budgets) {
    const notifications = z
      .object({
        Notifications: z.array(
          z.object({
            NotificationType: z.string(),
            ComparisonOperator: z.string(),
            Threshold: z.number(),
            ThresholdType: z.string().optional(),
            NotificationState: z.string().optional()
          })
        )
      })
      .parse(
        await read(
          'budgets',
          'describe-notifications-for-budget',
          '--account-id',
          expectedAccount ?? '',
          '--budget-name',
          budget.BudgetName
        )
      )
    const alerts = []
    for (const notification of notifications.Notifications) {
      const subscribers = z
        .object({ Subscribers: z.array(z.object({ SubscriptionType: z.string() })) })
        .parse(
          await read(
            'budgets',
            'describe-subscribers-for-notification',
            '--account-id',
            expectedAccount ?? '',
            '--budget-name',
            budget.BudgetName,
            '--notification',
            JSON.stringify(notification)
          )
        )
      alerts.push({
        notification,
        subscriberCount: subscribers.Subscribers.length,
        subscriberTypes: subscribers.Subscribers.map((subscriber) => subscriber.SubscriptionType)
      })
    }
    evidence.push({
      budgetType: budget.BudgetType,
      timeUnit: budget.TimeUnit,
      limit: budget.BudgetLimit,
      accountWide: Object.keys(budget.CostFilters ?? {}).length === 0,
      alerts
    })
  }
  const directory = process.env.ORCA_AWS_SPIKE_CAPTURE_DIR
  if (directory) {
    await mkdir(directory, { recursive: true })
    await writeFile(
      path.join(directory, 'aws-read-only-proof.json'),
      `${JSON.stringify({ capturedAt: new Date().toISOString(), identityMatchesExplicitExpectedAccount: true, evidence, projection: 'Budget names, account/role identifiers and subscriber addresses omitted. No credentials exported.' }, null, 2)}\n`
    )
  }
  expect(evidence.some((budget) => budget.alerts.some((alert) => alert.subscriberCount > 0))).toBe(
    true
  )
})
