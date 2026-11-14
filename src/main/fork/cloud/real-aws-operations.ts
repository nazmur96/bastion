import { z } from 'zod'
import { runProcess } from '@orca/process-host'
import { RealAwsFailure, type RealAwsCode } from '../../../shared/fork-cloud/real-aws-contract'
import type { RealAwsTool } from './real-aws-tool'
const token = z.string().min(1).max(4096).optional()
const account = z.string().regex(/^\d{12}$/)
const notification = z
  .object({
    NotificationType: z.enum(['ACTUAL', 'FORECASTED']),
    ComparisonOperator: z.enum(['GREATER_THAN', 'LESS_THAN', 'EQUAL_TO']),
    Threshold: z.number(),
    ThresholdType: z.enum(['PERCENTAGE', 'ABSOLUTE_VALUE']).optional(),
    NotificationState: z.enum(['OK', 'ALARM']).optional()
  })
  .strict()
const budget = {
  AccountId: account,
  BudgetName: z.string().min(1).max(100),
  MaxResults: z.literal(20),
  NextToken: token
}
const operations = {
  identity: {
    service: 'sts',
    action: 'get-caller-identity',
    params: z.object({}).strict(),
    query: '{Account:Account,Arn:Arn,UserId:UserId}'
  },
  role: {
    service: 'iam',
    action: 'get-role',
    params: z.object({ RoleName: z.string().regex(/^[\w+=,.@-]{1,64}$/) }).strict(),
    query: '{Role:{Arn:Role.Arn,RoleId:Role.RoleId}}'
  },
  tagging: {
    service: 'resourcegroupstaggingapi',
    action: 'get-resources',
    params: z.object({ ResourcesPerPage: z.literal(100), PaginationToken: token }).strict(),
    query:
      '{ResourceTagMappingList:ResourceTagMappingList[].{ResourceARN:ResourceARN},PaginationToken:PaginationToken}'
  },
  s3: {
    service: 's3api',
    action: 'list-buckets',
    params: z.object({ MaxBuckets: z.literal(100), ContinuationToken: token }).strict(),
    query: '{Buckets:Buckets[].{Name:Name},ContinuationToken:ContinuationToken}'
  },
  dynamodb: {
    service: 'dynamodb',
    action: 'list-tables',
    params: z.object({ Limit: z.literal(100), ExclusiveStartTableName: token }).strict(),
    query: '{TableNames:TableNames,LastEvaluatedTableName:LastEvaluatedTableName}'
  },
  sqs: {
    service: 'sqs',
    action: 'list-queues',
    params: z.object({ MaxResults: z.literal(100), NextToken: token }).strict(),
    query: '{QueueUrls:QueueUrls || `[]`,NextToken:NextToken}'
  },
  lambda: {
    service: 'lambda',
    action: 'list-functions',
    params: z.object({ MaxItems: z.literal(100), Marker: token }).strict(),
    query:
      '{Functions:Functions[].{FunctionName:FunctionName,FunctionArn:FunctionArn},NextMarker:NextMarker}'
  },
  budgets: {
    service: 'budgets',
    action: 'describe-budgets',
    params: z.object({ AccountId: account, MaxResults: z.literal(20), NextToken: token }).strict(),
    query: '{Budgets:Budgets[].{BudgetName:BudgetName,CostFilters:CostFilters},NextToken:NextToken}'
  },
  notifications: {
    service: 'budgets',
    action: 'describe-notifications-for-budget',
    params: z.object(budget).strict(),
    query: '{Notifications:Notifications,NextToken:NextToken}'
  },
  // Paid: one attempt per confirmed grant. Every field is a literal or the verified account.
  'cost-and-usage': {
    service: 'ce',
    action: 'get-cost-and-usage',
    params: z
      .object({
        TimePeriod: z
          .object({
            Start: z.string().regex(/^\d{4}-\d{2}-01$/),
            End: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
          })
          .strict(),
        Granularity: z.literal('DAILY'),
        Metrics: z.tuple([z.literal('UnblendedCost')]),
        Filter: z
          .object({
            Dimensions: z
              .object({ Key: z.literal('LINKED_ACCOUNT'), Values: z.tuple([account]) })
              .strict()
          })
          .strict()
      })
      .strict(),
    query:
      '{ResultsByTime:ResultsByTime[].{TimePeriod:TimePeriod,Total:Total,Estimated:Estimated},NextPageToken:NextPageToken}'
  },
  subscribers: {
    service: 'budgets',
    action: 'describe-subscribers-for-notification',
    params: z.object({ ...budget, Notification: notification }).strict(),
    query: '{Subscribers:Subscribers[].{SubscriptionType:SubscriptionType},NextToken:NextToken}'
  }
}
export type RealAwsOperation = keyof typeof operations
export function classifyRealAwsFailure(result: {
  code: number | null
  stderr: string
  timedOut?: boolean
  outputTruncated?: boolean
}): RealAwsCode {
  if (result.timedOut) {
    return 'timeout'
  }
  if (result.outputTruncated) {
    return 'too-large'
  }
  const message = result.stderr.slice(0, 8192)
  if (
    /\((ExpiredToken|ExpiredTokenException)\)|"Code"\s*:\s*"ExpiredToken(?:Exception)?"/.test(
      message
    )
  ) {
    return 'service-token-expired'
  }
  if (
    result.code === 255 &&
    /Your session has expired\. Please reauthenticate using 'aws login'\./.test(message)
  ) {
    return 'cli-session-expired'
  }
  if (
    /\((AccessDenied|AccessDeniedException|UnauthorizedOperation)\)|"Code"\s*:\s*"AccessDenied(?:Exception)?"/.test(
      message
    )
  ) {
    return 'denied'
  }
  if (
    result.code === 253 ||
    /\((InvalidClientTokenId|UnrecognizedClientException)\)/.test(message)
  ) {
    return 'auth-unavailable'
  }
  return 'cli-failed'
}
export async function callRealAwsOperation(
  tool: RealAwsTool,
  env: Record<string, string>,
  root: string,
  rawOperation: string,
  rawParameters: unknown,
  timeoutMs = 10000,
  audit: string[] = []
): Promise<unknown> {
  if (!Object.hasOwn(operations, rawOperation)) {
    throw new RealAwsFailure('invalid')
  }
  const id = z
    .enum([
      'identity',
      'role',
      'tagging',
      's3',
      'dynamodb',
      'sqs',
      'lambda',
      'budgets',
      'notifications',
      'subscribers',
      'cost-and-usage'
    ])
    .parse(rawOperation)
  const operation = operations[id],
    parameters = operation.params.safeParse(rawParameters)
  if (!parameters.success || !env.AWS_PROFILE || !env.AWS_REGION) {
    throw new RealAwsFailure('invalid')
  }
  tool.assertCurrent()
  const region = ['budgets', 'notifications', 'subscribers', 'role', 'cost-and-usage'].includes(id)
    ? 'us-east-1'
    : env.AWS_REGION
  audit.push(id)
  let result
  try {
    result = await runProcess({
      program: tool.executable,
      args: [
        operation.service,
        operation.action,
        '--cli-input-json',
        JSON.stringify(parameters.data),
        '--profile',
        env.AWS_PROFILE,
        '--region',
        region,
        '--output',
        'json',
        '--query',
        operation.query,
        '--no-paginate',
        '--no-cli-pager',
        '--no-cli-auto-prompt',
        '--cli-connect-timeout',
        '5',
        '--cli-read-timeout',
        '5'
      ],
      cwd: root,
      env,
      timeoutMs: Math.max(1, Math.min(10000, timeoutMs)),
      maxOutputBytes: 1024 * 1024,
      killOnOutputLimit: true
    })
  } catch {
    throw new RealAwsFailure('cli-failed')
  }
  tool.assertCurrent()
  if (Buffer.byteLength(result.stderr) > 8192) {
    throw new RealAwsFailure('too-large')
  }
  if (result.code !== 0 || result.timedOut || result.outputTruncated) {
    throw new RealAwsFailure(classifyRealAwsFailure(result))
  }
  try {
    return JSON.parse(result.stdout)
  } catch {
    throw new RealAwsFailure('unreadable')
  }
}
