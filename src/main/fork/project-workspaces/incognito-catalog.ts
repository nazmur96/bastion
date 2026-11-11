import { incognitoProcessAlive, stoppedIncognitoDaemonDirectory } from './incognito-runtime-cleanup'
import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type Database from '../../sqlite/sync-database'
import type { WorkspaceCatalog } from './workspace-catalog'
import { isIncognitoKind, type IncognitoTask } from '../../../shared/fork-project-workspaces'

export function upgradeIncognitoCatalog(db: Database.Database): void {
  db.exec(`CREATE TABLE incognito (
    workspaceId TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
    taskKind TEXT NOT NULL CHECK(taskKind IN ('terminal','browser','agent','file')),
    archivedAt INTEGER,
    fileName TEXT,
    agent TEXT NOT NULL DEFAULT 'claude' CHECK(agent IN ('claude','codex')),
    ownerPid INTEGER,
    deleting INTEGER NOT NULL DEFAULT 0 CHECK(deleting IN (0,1))
  ); PRAGMA user_version = 3;`)
}

export class IncognitoCatalog {
  constructor(
    private readonly db: Database.Database,
    private readonly catalog: WorkspaceCatalog
  ) {}

  get(id: string): IncognitoTask | null {
    const row = this.db.prepare('SELECT * FROM incognito WHERE workspaceId = ?').get(id)
    if (!row) {
      return null
    }
    if (
      !isIncognitoKind(row.taskKind) ||
      (row.deleting !== 0 && row.deleting !== 1) ||
      (row.archivedAt !== null && typeof row.archivedAt !== 'number') ||
      (row.fileName !== null && typeof row.fileName !== 'string') ||
      (row.agent !== 'claude' && row.agent !== 'codex')
    ) {
      throw new Error('Invalid Incognito record.')
    }
    return {
      workspace: this.catalog.get(id),
      kind: row.taskKind,
      archivedAt: row.archivedAt,
      deleting: row.deleting === 1,
      fileName: row.fileName,
      agent: row.agent
    }
  }

  list(): IncognitoTask[] {
    return this.db
      .prepare('SELECT workspaceId FROM incognito ORDER BY rowid DESC')
      .all()
      .map((row) => {
        if (typeof row.workspaceId !== 'string') {
          throw new Error('Invalid Incognito owner.')
        }
        const task = this.get(row.workspaceId)
        if (!task) {
          throw new Error('Incognito task disappeared.')
        }
        return task
      })
  }

  create(kind: unknown, rawFileName: unknown, rawAgent: unknown): IncognitoTask {
    if (!isIncognitoKind(kind)) {
      throw new Error('Choose a terminal, browser, agent or file.')
    }
    if (
      kind === 'agent' &&
      rawAgent !== undefined &&
      rawAgent !== 'claude' &&
      rawAgent !== 'codex'
    ) {
      throw new Error('Choose a supported agent: Claude or Codex.')
    }
    const fileName = kind === 'file' ? validateIncognitoFileName(rawFileName) : null
    const agent = rawAgent === 'codex' ? 'codex' : 'claude'
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const workspace = this.catalog.create(`Incognito ${kind} ${randomUUID().slice(0, 8)}`)
      this.db
        .prepare(
          'INSERT INTO incognito (workspaceId, taskKind, archivedAt, fileName, agent) VALUES (?, ?, ?, ?, ?)'
        )
        .run(workspace.id, kind, Date.now(), fileName, agent)
      this.db.exec('COMMIT')
      return { workspace, kind, archivedAt: Date.now(), deleting: false, fileName, agent }
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  markActive(id: string): void {
    const task = this.get(id)
    if (!task) {
      return
    }
    if (task.deleting) {
      throw new Error('This Incognito task is being deleted. Retry deletion from Archive.')
    }
    const result = this.db
      .prepare(
        'UPDATE incognito SET archivedAt = NULL, ownerPid = ? WHERE workspaceId = ? AND deleting = 0'
      )
      .run(process.pid, id)
    if (result.changes !== 1) {
      throw new Error('This task is being deleted.')
    }
  }

  archiveOwn(id: string): void {
    this.db
      .prepare('UPDATE incognito SET archivedAt = ? WHERE workspaceId = ? AND ownerPid = ?')
      .run(Date.now(), id, process.pid)
  }

  scratch(id: string): string {
    if (!this.get(id)) {
      throw new Error('Not an Incognito task.')
    }
    const root = join(this.catalog.dataRoot(id), 'scratch')
    mkdirSync(root, { recursive: true, mode: 0o700 })
    return root
  }

  async remove(id: string): Promise<void> {
    if (!this.catalog.atHome() || !this.get(id)) {
      throw new Error('Delete Incognito tasks from application Home.')
    }
    const dataRoot = this.catalog.dataRoot(id)
    let daemonDirectory: string
    this.db.exec('BEGIN IMMEDIATE')
    try {
      if (!this.catalog.atHome()) {
        throw new Error('Return to Home before deleting this task.')
      }
      const row = this.db.prepare('SELECT ownerPid FROM incognito WHERE workspaceId = ?').get(id)
      if (incognitoProcessAlive(row?.ownerPid)) {
        throw new Error('This task is still running or closing. Leave it, then try again.')
      }
      daemonDirectory = stoppedIncognitoDaemonDirectory(dataRoot)
      this.db.prepare('UPDATE incognito SET deleting = 1 WHERE workspaceId = ?').run(id)
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
    // Only the owned namespace is removed; attached external folders are never traversed.
    await rm(dataRoot, { recursive: true, force: true })
    await rm(daemonDirectory, { recursive: true, force: true })
    this.db.exec('BEGIN IMMEDIATE')
    try {
      this.db.prepare("UPDATE selection SET workspaceId = 'existing' WHERE workspaceId = ?").run(id)
      this.db.prepare('DELETE FROM workspaces WHERE id = ?').run(id)
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }
}

export function validateIncognitoFileName(value: unknown): string {
  const name = typeof value === 'string' ? value.trim() : 'Untitled.txt'
  if (
    !name ||
    name.length > 120 ||
    name === '.' ||
    name === '..' ||
    basename(name) !== name ||
    /[\\/\p{Cc}]/u.test(name)
  ) {
    throw new Error('Use a file name without folders or control characters.')
  }
  return name
}
