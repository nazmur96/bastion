import type Database from '../../sqlite/sync-database'
import {
  realAwsReadReceiptSchema,
  type RealAwsReadReceipt
} from '../../../shared/fork-cloud/real-aws-contract'

const HISTORY_LIMIT = 10000
// Fields that identify a request; a reused UUID must match all of them.
const REQUEST_FIELDS = [
  'namespaceId',
  'projectId',
  'targetId',
  'operation',
  'contextFingerprint',
  'identityFingerprint'
] as const
// Fields that never change after admission, including who owns the attempt.
const IMMUTABLE_FIELDS = [
  ...REQUEST_FIELDS,
  'requestId',
  'toolFingerprint',
  'ownerRunId',
  'at'
] as const

export function readRealAwsReceipt(
  db: Database.Database,
  requestId: string
): RealAwsReadReceipt | null {
  const row = db
    .prepare('SELECT receipt FROM real_aws_read_receipts WHERE requestId = ?')
    .get(requestId)
  return typeof row?.receipt === 'string'
    ? realAwsReadReceiptSchema.parse(JSON.parse(row.receipt))
    : null
}

/** Call inside a write transaction. A receipt is committed before any provider request. */
export function admitRealAwsReceipt(
  db: Database.Database,
  raw: RealAwsReadReceipt
): { receipt: RealAwsReadReceipt; created: boolean } {
  const receipt = realAwsReadReceiptSchema.parse(raw)
  if (receipt.status !== 'running') {
    throw new Error('A real AWS read receipt is admitted as running.')
  }
  const previous = readRealAwsReceipt(db, receipt.requestId)
  if (previous) {
    if (REQUEST_FIELDS.some((field) => previous[field] !== receipt[field])) {
      throw new Error('Request identifier already belongs to a different read.')
    }
    return { receipt: previous, created: false }
  }
  const count = db.prepare('SELECT COUNT(*) AS count FROM real_aws_read_receipts').get()?.count
  if (typeof count !== 'number' || count >= HISTORY_LIMIT) {
    throw new Error('Real AWS read history limit reached; existing receipts are preserved.')
  }
  db.prepare('INSERT INTO real_aws_read_receipts VALUES (?, ?)').run(
    receipt.requestId,
    JSON.stringify(receipt)
  )
  return { receipt, created: true }
}

/** Call inside a write transaction. Only a running receipt settles, once, by its own owner. */
export function settleRealAwsReceipt(db: Database.Database, raw: RealAwsReadReceipt): void {
  const receipt = realAwsReadReceiptSchema.parse(raw)
  const previous = readRealAwsReceipt(db, receipt.requestId)
  if (
    !previous ||
    previous.status !== 'running' ||
    receipt.status === 'running' ||
    IMMUTABLE_FIELDS.some((field) => previous[field] !== receipt[field])
  ) {
    throw new Error('Real AWS read receipt is already settled or belongs to another owner.')
  }
  db.prepare('UPDATE real_aws_read_receipts SET receipt = ? WHERE requestId = ?').run(
    JSON.stringify(receipt),
    receipt.requestId
  )
}

/** Marks running reads of owners that are known to be gone as unknown; never as success. */
export function recoverRealAwsReceipts(
  db: Database.Database,
  isDead: (ownerRunId: string) => boolean,
  now = Date.now()
): void {
  const rows = db
    .prepare(
      "SELECT receipt FROM real_aws_read_receipts WHERE json_extract(receipt, '$.status') = 'running'"
    )
    .all()
  for (const row of rows) {
    const receipt = realAwsReadReceiptSchema.parse(JSON.parse(String(row.receipt)))
    if (isDead(receipt.ownerRunId)) {
      settleRealAwsReceipt(db, {
        ...receipt,
        status: 'unknown',
        code: 'interrupted',
        finishedAt: now
      })
    }
  }
}
