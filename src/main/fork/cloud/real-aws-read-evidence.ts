import { createHash } from 'node:crypto'
import { z } from 'zod'
import {
  RealAwsFailure,
  type RealAwsCostData,
  type RealAwsCostQuery,
  type RealAwsIdentity,
  type RealAwsReadReceipt
} from '../../../shared/fork-cloud/real-aws-contract'
import type { ChangeLedger } from '../changes/change-ledger'

export function fingerprint(value: unknown): string {
  return `sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`
}
export function identityFingerprint(identity: RealAwsIdentity): string {
  return fingerprint([identity.accountId, identity.arn, identity.userId, identity.roleArn])
}
/** Current UTC month to date, end exclusive. Null on the first day: nothing to ask for yet. */
export function costQuery(accountId: string, now = Date.now()): RealAwsCostQuery | null {
  const end = new Date(now).toISOString().slice(0, 10),
    start = `${end.slice(0, 8)}01`
  return start === end
    ? null
    : {
        TimePeriod: { Start: start, End: end },
        Granularity: 'DAILY',
        Metrics: ['UnblendedCost'],
        Filter: { Dimensions: { Key: 'LINKED_ACCOUNT', Values: [accountId] } }
      }
}
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const costPage = z.object({
  ResultsByTime: z
    .array(
      z.object({
        TimePeriod: z.object({ Start: day, End: day }),
        Total: z
          .object({
            UnblendedCost: z
              .object({
                Amount: z.string().regex(/^-?\d{1,20}(\.\d{1,12})?$/),
                Unit: z.string().regex(/^[A-Z]{3}$/)
              })
              .optional()
          })
          .nullish(),
        Estimated: z.boolean().optional()
      })
    )
    .max(62)
    .nullish(),
  NextPageToken: z.string().max(4096).nullish()
})
export function projectCost(raw: unknown): RealAwsCostData {
  const parsed = costPage.safeParse(raw)
  if (!parsed.success) {
    throw new RealAwsFailure('unreadable')
  }
  const results = (parsed.data.ResultsByTime ?? []).flatMap((row) => {
    const cost = row.Total?.UnblendedCost
    return cost
      ? [
          {
            start: row.TimePeriod.Start,
            end: row.TimePeriod.End,
            amount: cost.Amount,
            unit: cost.Unit,
            estimated: row.Estimated ?? false
          }
        ]
      : []
  })
  // A continuation token is only reported; another page would need another confirmation.
  return { results, moreAvailable: Boolean(parsed.data.NextPageToken) }
}
/** Resources/budgets evidence: admitted before the batch, settled once with counts only. */
export async function withReadReceipt<T>(
  ledger: ChangeLedger,
  receipt: RealAwsReadReceipt,
  run: () => Promise<{ value: T; results: NonNullable<RealAwsReadReceipt['results']> }>
): Promise<T> {
  try {
    ledger.admitReadReceipt(receipt)
  } catch {
    throw new RealAwsFailure('storage')
  }
  try {
    const { value, results } = await run()
    ledger.settleReadReceipt({
      ...receipt,
      status: 'completed',
      finishedAt: Date.now(),
      code: 'ok',
      results
    })
    return value
  } catch (error) {
    const code = error instanceof RealAwsFailure ? error.code : 'unreadable'
    try {
      ledger.settleReadReceipt({ ...receipt, status: 'failed', finishedAt: Date.now(), code })
    } catch {
      // Already settled by recovery.
    }
    throw error
  }
}

/** A running receipt for a resources/budgets batch, from admitted metadata only. */
export function runningReceipt(
  session: {
    context: { stamp: string; namespaceId?: string }
    tool: { fingerprint: string }
  },
  request: {
    requestId: string
    projectId: string
    targetId: string
    operation: 'resources' | 'budgets'
    identity: RealAwsIdentity
    ownerRunId: string
  }
): RealAwsReadReceipt {
  return {
    requestId: request.requestId,
    namespaceId: session.context.namespaceId ?? 'local',
    projectId: request.projectId,
    targetId: request.targetId,
    operation: request.operation,
    contextFingerprint: fingerprint([
      session.context.stamp,
      session.tool.fingerprint,
      request.operation
    ]),
    toolFingerprint: fingerprint(session.tool.fingerprint),
    identityFingerprint: identityFingerprint(request.identity),
    ownerRunId: request.ownerRunId,
    at: Date.now(),
    status: 'running'
  }
}

/** Drops expired entries and keeps a bounded number of pending ones. */
export function evict<T extends { expiresAt: number }>(
  map: Map<string, T>,
  now: number,
  limit = 200
): void {
  for (const [id, entry] of map) {
    if (entry.expiresAt <= now) {
      map.delete(id)
    }
  }
  while (map.size >= limit) {
    map.delete(map.keys().next().value ?? '')
  }
}
