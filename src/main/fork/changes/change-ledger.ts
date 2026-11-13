import { randomUUID } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import Database from '../../sqlite/sync-database'
import { hardenSqliteDatabaseFiles } from '../../sqlite/harden-database-files'
import {
  changeCommandSchema,
  changeEntranceSchema,
  changeRecordSchema,
  changeScopeSchema,
  type ChangeCommand,
  type ChangeEntrance,
  type ChangeRecord,
  type ChangeScope
} from '../../../shared/fork-changes/change-contract'
import { applyChangeCommand } from '../../../shared/fork-changes/change-lifecycle'

function decode(row: Record<string, unknown> | undefined): ChangeRecord {
  if (typeof row?.record !== 'string') {
    throw new Error('Change record not found.')
  }
  return changeRecordSchema.parse(JSON.parse(row.record))
}

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
      this.transaction(() => {
        const version = this.db.pragma('user_version', { simple: true })
        if (version !== 0 && version !== 1) {
          throw new Error('Unsupported change ledger version.')
        }
        if (version === 0) {
          if (
            this.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().length > 0
          ) {
            throw new Error('Unrecognized change ledger.')
          }
          this.db.exec(
            'CREATE TABLE changes (id TEXT PRIMARY KEY, scope TEXT NOT NULL UNIQUE, record TEXT NOT NULL); PRAGMA user_version = 1;'
          )
        }
      })
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

  ensure(rawScope: ChangeScope, rawEntrance: ChangeEntrance): ChangeRecord {
    const scope = changeScopeSchema.parse(rawScope)
    const entrance = changeEntranceSchema.parse(rawEntrance)
    const key = JSON.stringify(scope)
    return this.transaction(() => {
      const row = this.db.prepare('SELECT record FROM changes WHERE scope = ?').get(key)
      if (row) {
        const record = decode(row)
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
        entrances: [entrance],
        validations: [],
        reviews: [],
        runs: []
      }
      this.db
        .prepare('INSERT INTO changes (id, scope, record) VALUES (?, ?, ?)')
        .run(record.id, key, JSON.stringify(record))
      return record
    })
  }

  private save(record: ChangeRecord): void {
    this.db
      .prepare('UPDATE changes SET record = ? WHERE id = ?')
      .run(JSON.stringify(record), record.id)
  }

  command(id: string, revision: number, rawCommand: ChangeCommand): ChangeRecord {
    const command = changeCommandSchema.parse(rawCommand)
    return this.transaction(() => {
      const record = decode(this.db.prepare('SELECT record FROM changes WHERE id = ?').get(id))
      if (record.revision !== revision) {
        throw new Error('The change was updated elsewhere. Reopen it before continuing.')
      }
      const next = applyChangeCommand(record, command, randomUUID(), Date.now())
      this.save(next)
      return next
    })
  }

  interruptRunning(runIds?: ReadonlySet<string>): void {
    this.transaction(() => {
      for (const row of this.db.prepare('SELECT record FROM changes').all()) {
        const record = decode(row)
        let changed = false
        for (const run of record.runs) {
          if (run.status === 'running' && (!runIds || runIds.has(run.id))) {
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
