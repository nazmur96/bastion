import { randomUUID } from 'node:crypto'
import { chmodSync, existsSync, lstatSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import Database from '../../sqlite/sync-database'
import { hardenSqliteDatabaseFiles } from '../../sqlite/harden-database-files'
import {
  cloudMutationSchema,
  cloudOwnerSchema,
  cloudSelectionSchema,
  cloudTargetSchema,
  CloudTargetRefusal,
  type CloudCatalogSnapshot,
  type CloudOwner,
  type CloudSelection,
  type CloudTarget
} from '../../../shared/fork-cloud/cloud-target-contract'

function recordValue(row: unknown): unknown {
  if (!row || typeof row !== 'object' || !('record' in row) || typeof row.record !== 'string') {
    throw new CloudTargetRefusal('storage')
  }
  return JSON.parse(row.record)
}
export class CloudTargetCatalog {
  private db: Database.Database
  constructor(namespaceRoot: string) {
    const directory = join(namespaceRoot, 'bastion-cloud')
    if (
      existsSync(directory) &&
      (!lstatSync(directory).isDirectory() || lstatSync(directory).isSymbolicLink())
    ) {
      throw new CloudTargetRefusal('storage')
    }
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    if (process.platform !== 'win32') {
      chmodSync(directory, 0o700)
    }
    const file = join(directory, 'targets.db')
    for (const candidate of [file, `${file}-wal`, `${file}-shm`]) {
      try {
        const stat = lstatSync(candidate)
        if (!stat.isFile() || stat.isSymbolicLink()) {
          throw new CloudTargetRefusal('storage')
        }
      } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
          throw error
        }
      }
    }
    this.db = new Database(file)
    try {
      const version = this.db.pragma('user_version', { simple: true })
      if (version !== 0 && version !== 1) {
        throw new Error('Cloud target storage is newer than this application.')
      }
      this.db.pragma('busy_timeout = 5000')
      this.db.pragma('journal_mode = WAL')
      this.db.pragma('synchronous = FULL')
      this.db.exec(
        'CREATE TABLE IF NOT EXISTS targets (id TEXT PRIMARY KEY, record TEXT NOT NULL); CREATE TABLE IF NOT EXISTS selections (project_id TEXT PRIMARY KEY, record TEXT NOT NULL); CREATE TABLE IF NOT EXISTS meta (id INTEGER PRIMARY KEY CHECK(id = 1), revision INTEGER NOT NULL); INSERT OR IGNORE INTO meta VALUES (1, 0); PRAGMA user_version = 1;'
      )
      hardenSqliteDatabaseFiles(file)
    } catch (error) {
      this.db.close()
      throw error
    }
  }
  close(): void {
    this.db.close()
  }
  snapshot(projectId?: string): CloudCatalogSnapshot {
    const meta = this.db.prepare('SELECT revision FROM meta WHERE id = 1').get()
    if (!meta || typeof meta.revision !== 'number') {
      throw new CloudTargetRefusal('storage')
    }
    const targets = this.db
      .prepare('SELECT record FROM targets ORDER BY id')
      .all()
      .map((row) => cloudTargetSchema.parse(recordValue(row)))
      .filter((target) => target.deletedAt === null)
    const row = projectId
      ? this.db.prepare('SELECT record FROM selections WHERE project_id = ?').get(projectId)
      : undefined
    return {
      revision: meta.revision,
      targets,
      selection: row ? cloudSelectionSchema.parse(recordValue(row)) : null
    }
  }
  private transaction(revision: number, action: () => void): void {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      if (this.snapshot().revision !== revision) {
        throw new CloudTargetRefusal('conflict')
      }
      action()
      this.db.prepare('UPDATE meta SET revision = revision + 1 WHERE id = 1').run()
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }
  private saveTarget(target: CloudTarget): void {
    this.db
      .prepare('INSERT OR REPLACE INTO targets VALUES (?, ?)')
      .run(target.id, JSON.stringify(target))
  }
  private saveSelection(selection: CloudSelection): void {
    this.db
      .prepare('INSERT OR REPLACE INTO selections VALUES (?, ?)')
      .run(selection.projectId, JSON.stringify(selection))
  }
  mutate(revision: number, raw: unknown): void {
    const parsed = cloudMutationSchema.safeParse(raw)
    if (!parsed.success) {
      throw new CloudTargetRefusal('invalid')
    }
    const mutation = parsed.data
    this.transaction(revision, () => {
      const now = Date.now()
      if (mutation.kind === 'add') {
        // Removed targets stay as tombstones for history; only live targets count toward the limit.
        if (this.snapshot().targets.length >= 200) {
          throw new CloudTargetRefusal('limit')
        }
        this.saveTarget({
          id: randomUUID(),
          label: mutation.label,
          configuration: mutation.configuration,
          displayRevision: 0,
          configRevision: 0,
          createdAt: now,
          updatedAt: now,
          deletedAt: null
        })
        return
      }
      const target = this.snapshot().targets.find((item) => item.id === mutation.id)
      if (!target) {
        throw new CloudTargetRefusal('unavailable')
      }
      if (mutation.kind === 'rename') {
        target.label = mutation.label
        target.displayRevision++
      } else {
        target.deletedAt = now
        for (const row of this.db.prepare('SELECT record FROM selections').all()) {
          const selection = cloudSelectionSchema.parse(recordValue(row))
          if (selection.targetId === target.id) {
            this.saveSelection({
              ...selection,
              targetId: null,
              generation: selection.generation + 1
            })
          }
        }
      }
      target.updatedAt = now
      this.saveTarget(target)
    })
  }
  select(revision: number, projectId: string, targetId: string | null, owner: CloudOwner): void {
    const parsed = cloudSelectionSchema.safeParse({
      projectId,
      targetId,
      generation: 0,
      owner: cloudOwnerSchema.parse(owner)
    })
    if (!parsed.success) {
      throw new CloudTargetRefusal('invalid')
    }
    this.transaction(revision, () => {
      const snapshot = this.snapshot(projectId)
      if (targetId !== null && !snapshot.targets.some((target) => target.id === targetId)) {
        throw new CloudTargetRefusal('unavailable')
      }
      this.saveSelection({ ...parsed.data, generation: (snapshot.selection?.generation ?? 0) + 1 })
    })
  }
}
