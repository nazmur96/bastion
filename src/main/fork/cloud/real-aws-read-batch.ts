import { RealAwsFailure, type RealAwsIdentity } from '../../../shared/fork-cloud/real-aws-contract'
import type { ChangeLedger } from '../changes/change-ledger'
import type { RealAwsSession } from './real-aws-cost'
import { readRealAwsBackups } from './real-aws-backups'
import { readRealAwsBudgets } from './real-aws-budgets'
import { listRealAwsResources } from './real-aws-resources'
import { runningReceipt, withReadReceipt } from './real-aws-read-evidence'

function sameIdentity(a: RealAwsIdentity, b: RealAwsIdentity): boolean {
  return (
    a.accountId === b.accountId &&
    a.arn === b.arn &&
    a.userId === b.userId &&
    a.roleArn === b.roleArn
  )
}
/** One resources or budgets batch between two identity checks, with an optional durable receipt. */
export async function readRealAwsBatch(
  session: RealAwsSession & { operations: string[] },
  request: {
    projectId: string
    targetId: string
    operation: 'resources' | 'budgets' | 'backups'
    requestId?: string
    ledger?: ChangeLedger
    ownerRunId: string
  }
) {
  if (!session.context.configuration.expectedAccountId) {
    throw new RealAwsFailure('identity-required')
  }
  const before = await session.check(false)
  const batch = async () => {
    const data =
      request.operation === 'resources'
        ? await listRealAwsResources(session.call, before.accountId)
        : request.operation === 'backups'
          ? await readRealAwsBackups(session.call)
          : await readRealAwsBudgets(session.call, before.accountId)
    const after = await session.check(false)
    if (!sameIdentity(before, after)) {
      throw new RealAwsFailure('identity-mismatch')
    }
    session.context.current()
    session.tool.assertCurrent()
    const value = { identity: after, data, operations: session.operations }
    const results =
      'results' in data
        ? data.results.map((item) => ({
            code: item.status,
            count: item.items.length,
            truncated: item.truncated
          }))
        : [
            {
              code: data.status,
              count: 'databases' in data ? data.databases.length : data.alerts,
              truncated: data.truncated
            }
          ]
    return { value, results }
  }
  const { requestId, ledger } = request
  if (!requestId || !ledger) {
    return (await batch()).value
  }
  const receipt = runningReceipt(session, { ...request, requestId, identity: before })
  return withReadReceipt(ledger, receipt, batch)
}
