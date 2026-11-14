import type Database from '../../sqlite/sync-database'
import {
  changeRecordSchema,
  SOURCE_CHECK_INTENT,
  type ChangeIntent,
  type ChangeRecord,
  type ChangeScope
} from '../../../shared/fork-changes/change-contract'

export function changeIdentity(scope: ChangeScope, intent: ChangeIntent): string {
  return JSON.stringify([scope.projectId, intent.id])
}
export function decodeChange(row: Record<string, unknown> | undefined): ChangeRecord {
  if (typeof row?.record !== 'string') {
    throw new Error('Change record not found.')
  }
  const record = changeRecordSchema.parse(JSON.parse(row.record))
  record.intent ??= SOURCE_CHECK_INTENT
  for (const item of [...record.validations, ...record.reviews, ...record.runs]) {
    item.scope ??= record.scope
  }
  return record
}
export function upgradeChangeLedger(db: Database.Database): void {
  const version = db.pragma('user_version', { simple: true })
  if (![0, 1, 2, 3, 4, 5].includes(Number(version))) {
    throw new Error('Unsupported change ledger version.')
  }
  if (version === 5) {
    return
  }
  if (version === 4) {
    // Additive: real AWS read receipts. Existing records and receipts are not touched.
    db.exec(
      'CREATE TABLE real_aws_read_receipts (requestId TEXT PRIMARY KEY, receipt TEXT NOT NULL); PRAGMA user_version = 5;'
    )
    return
  }
  if (version === 3) {
    db.exec(
      'CREATE TABLE IF NOT EXISTS cloud_lifecycle_receipts (id TEXT PRIMARY KEY, receipt TEXT NOT NULL); PRAGMA user_version = 4;'
    )
    upgradeChangeLedger(db)
    return
  }
  if (version === 2) {
    db.exec(
      'CREATE TABLE owner_receipts (id TEXT PRIMARY KEY, receipt TEXT NOT NULL); PRAGMA user_version = 3;'
    )
    upgradeChangeLedger(db)
    return
  }
  if (
    version === 0 &&
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().length > 0
  ) {
    throw new Error('Unrecognized change ledger.')
  }
  const previous =
    version === 1 ? db.prepare('SELECT record FROM changes').all().map(decodeChange) : []
  db.exec(
    'CREATE TABLE change_records (id TEXT PRIMARY KEY, identity TEXT NOT NULL UNIQUE, record TEXT NOT NULL); CREATE TABLE change_aliases (id TEXT PRIMARY KEY, canonicalId TEXT NOT NULL REFERENCES change_records(id));'
  )
  const grouped = new Map<string, ChangeRecord>()
  for (const record of previous) {
    const key = changeIdentity(record.scope, record.intent ?? SOURCE_CHECK_INTENT)
    const first = grouped.get(key)
    if (!first) {
      grouped.set(key, record)
      continue
    }
    first.entrances = [...new Set([...first.entrances, ...record.entrances])]
    const sort = <T extends { at: number; id: string }>(a: T[], b: T[]): T[] =>
      [...a, ...b].sort((left, right) => left.at - right.at || left.id.localeCompare(right.id))
    first.validations = sort(first.validations, record.validations)
    first.reviews = sort(first.reviews, record.reviews)
    first.runs = sort(first.runs, record.runs)
    first.revision = Math.max(first.revision, record.revision) + 1
  }
  for (const [key, record] of grouped) {
    const newest = record.validations.at(-1)?.scope
    if (newest) {
      record.scope = newest
    }
    changeRecordSchema.parse(record)
    db.prepare('INSERT INTO change_records VALUES (?, ?, ?)').run(
      record.id,
      key,
      JSON.stringify(record)
    )
  }
  for (const record of previous) {
    const canonical = grouped.get(
      changeIdentity(record.scope, record.intent ?? SOURCE_CHECK_INTENT)
    )
    if (canonical) {
      db.prepare('INSERT INTO change_aliases VALUES (?, ?)').run(record.id, canonical.id)
    }
  }
  if (version === 1) {
    db.exec('DROP TABLE changes')
  }
  db.exec(
    'CREATE TABLE owner_receipts (id TEXT PRIMARY KEY, receipt TEXT NOT NULL); CREATE TABLE cloud_lifecycle_receipts (id TEXT PRIMARY KEY, receipt TEXT NOT NULL); PRAGMA user_version = 4'
  )
  upgradeChangeLedger(db)
}
