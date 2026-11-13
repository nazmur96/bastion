import { randomUUID } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import Database from '../../sqlite/sync-database'
import { hardenSqliteDatabaseFiles } from '../../sqlite/harden-database-files'
import {
  changeCommandSchema,
  changeEntranceSchema,
  changeIntentSchema,
  SOURCE_CHECK_INTENT,
  type ChangeIntent,
  sameChangeScope,
  sameChangeTarget,
  ownerRunReceiptSchema,
  sameChangeSnapshot,
  type OwnerRunReceipt,
  changeScopeSchema,
  type ChangeCommand,
  type ChangeEntrance,
  type ChangeRecord,
  type ChangeScope
} from '../../../shared/fork-changes/change-contract'
import { applyChangeCommand } from '../../../shared/fork-changes/change-lifecycle'
import { changeIdentity, decodeChange, upgradeChangeLedger } from './change-ledger-migration'

export class ChangeLedger {
  private db: Database.Database

  constructor(namespaceRoot: string) {
    const directory = join(namespaceRoot, 'bastion-changes')
    if (
      existsSync(directory) &&
      (!lstatSync(directory).isDirectory() || lstatSync(directory).isSymbolicLink())
    ) {
      throw new Error('Change storage must be a private directory.')
    }
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    const file = join(directory, 'changes.db')
    if (existsSync(file) && (!lstatSync(file).isFile() || lstatSync(file).isSymbolicLink())) {
      throw new Error('Change storage must be a regular database.')
    }
    this.db = new Database(file)
    try {
      this.db.pragma('busy_timeout = 5000')
      this.db.pragma('journal_mode = WAL')
      this.db.pragma('synchronous = FULL')
      this.transaction(() => upgradeChangeLedger(this.db))
      hardenSqliteDatabaseFiles(file)
    } catch (error) {
      this.db.close()
      throw error
    }
  }

  private transaction<T>(action: () => T): T {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const value = action()
      this.db.exec('COMMIT')
      return value
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  ensure(
    rawScope: ChangeScope,
    rawEntrance: ChangeEntrance,
    rawIntent: ChangeIntent = SOURCE_CHECK_INTENT
  ): ChangeRecord {
    const scope = changeScopeSchema.parse(rawScope)
    const entrance = changeEntranceSchema.parse(rawEntrance)
    const intent = changeIntentSchema.parse(rawIntent)
    const key = changeIdentity(scope, intent)
    return this.transaction(() => {
      const row = this.db.prepare('SELECT record FROM change_records WHERE identity = ?').get(key)
      if (row) {
        const record = decodeChange(row)
        if (record.intent?.kind !== intent.kind) {
          throw new Error('Change intent kind cannot be replaced.')
        }
        if (!sameChangeScope(record.scope, scope)) {
          for (const run of record.runs) {
            if (
              run.execution &&
              run.status === 'running' &&
              !sameChangeTarget(run.scope ?? record.scope, scope)
            ) {
              run.status = 'interrupted'
              run.finishedAt = Date.now()
            }
          }
          record.scope = scope
          record.invalidated = true
          record.revision++
          this.save(record)
        }
        if (!record.entrances.includes(entrance)) {
          record.entrances.push(entrance)
          this.save(record)
        }
        return record
      }
      const record: ChangeRecord = {
        id: randomUUID(),
        revision: 0,
        scope,
        intent,
        entrances: [entrance],
        validations: [],
        reviews: [],
        runs: []
      }
      this.db
        .prepare('INSERT INTO change_records (id, identity, record) VALUES (?, ?, ?)')
        .run(record.id, key, JSON.stringify(record))
      return record
    })
  }

  get(id: string): ChangeRecord {
    return decodeChange(
      this.db
        .prepare(
          'SELECT record FROM change_records WHERE id = COALESCE((SELECT canonicalId FROM change_aliases WHERE id = ?), ?)'
        )
        .get(id, id)
    )
  }

  list(projectId: string): ChangeRecord[] {
    return this.db
      .prepare('SELECT record FROM change_records')
      .all()
      .map(decodeChange)
      .filter((record) => record.scope.projectId === projectId)
  }

  receipt(id: string): OwnerRunReceipt | null {
    const row = this.db.prepare('SELECT receipt FROM owner_receipts WHERE id = ?').get(id)
    return typeof row?.receipt === 'string'
      ? ownerRunReceiptSchema.parse(JSON.parse(row.receipt))
      : null
  }

  admitReceipt(receipt: OwnerRunReceipt): { receipt: OwnerRunReceipt; created: boolean } {
    return this.transaction(() => {
      const previous = this.receipt(receipt.id)
      if (previous) {
        if (
          previous.root !== receipt.root ||
          previous.runtimeId !== receipt.runtimeId ||
          previous.worktreeId !== receipt.worktreeId ||
          !sameChangeSnapshot(previous.snapshot, receipt.snapshot)
        ) {
          throw new Error('Run identifier already belongs to a different request.')
        }
        return { receipt: previous, created: false }
      }
      const count = this.db.prepare('SELECT COUNT(*) AS count FROM owner_receipts').get()?.count
      if (typeof count !== 'number' || count >= 10000) {
        throw new Error('Owner run history limit reached; existing receipts are preserved.')
      }
      this.db
        .prepare('INSERT INTO owner_receipts VALUES (?, ?)')
        .run(receipt.id, JSON.stringify(ownerRunReceiptSchema.parse(receipt)))
      return { receipt, created: true }
    })
  }

  saveReceipt(receipt: OwnerRunReceipt): void {
    ownerRunReceiptSchema.parse(receipt)
    const previous = this.receipt(receipt.id)
    if (!previous || previous.status !== 'running') {
      throw new Error('Owner receipt is already settled.')
    }
    this.db
      .prepare('UPDATE owner_receipts SET receipt = ? WHERE id = ?')
      .run(JSON.stringify(receipt), receipt.id)
  }

  private save(record: ChangeRecord): void {
    this.db
      .prepare('UPDATE change_records SET record = ? WHERE id = ?')
      .run(JSON.stringify(record), record.id)
  }

  command(id: string, revision: number, rawCommand: ChangeCommand): ChangeRecord {
    const command = changeCommandSchema.parse(rawCommand)
    return this.transaction(() => {
      const record = this.get(id)
      if (
        record.revision !== revision &&
        (command.kind === 'validate' ||
          command.kind === 'review' ||
          command.kind === 'start' ||
          command.kind === 'invalidate')
      ) {
        throw new Error('The change was updated elsewhere. Reopen it before continuing.')
      }
      const next = applyChangeCommand(record, command, randomUUID(), Date.now())
      this.save(next)
      return next
    })
  }

  interruptRunning(runIds?: ReadonlySet<string>): void {
    this.transaction(() => {
      for (const row of this.db.prepare('SELECT record FROM change_records').all()) {
        const record = decodeChange(row)
        let changed = false
        for (const run of record.runs) {
          if (run.status === 'running' && !run.execution && (!runIds || runIds.has(run.id))) {
            run.status = 'interrupted'
            run.finishedAt = Date.now()
            changed = true
          }
        }
        if (changed) {
          record.revision++
          this.save(record)
        }
      }
    })
  }

  close(): void {
    this.db.close()
  }
}
