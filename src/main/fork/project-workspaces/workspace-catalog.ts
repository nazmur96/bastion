import { randomUUID } from 'node:crypto'
import { IncognitoCatalog, upgradeIncognitoCatalog } from './incognito-catalog'
import { existsSync, lstatSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import Database from '../../sqlite/sync-database'
import { hardenSqliteDatabaseFiles } from '../../sqlite/harden-database-files'
import {
  isProjectWorkspaceId,
  projectWorkspaceName,
  type ProjectWorkspace
} from '../../../shared/fork-project-workspaces'

const SCHEMA_VERSION = 3
const WORKSPACE_COLUMNS =
  'w.id, w.name, w.kind, w.createdAt, w.updatedAt, s.repoCount, s.openedAt FROM workspaces w LEFT JOIN summary s ON s.workspaceId = w.id'

export function workspaceCatalogDirectory(baseRoot: string): string {
  const path = join(baseRoot, 'bastion-project-workspaces')
  ensurePrivateDirectory(path)
  return path
}

function ensurePrivateDirectory(path: string): void {
  if (existsSync(path) && (lstatSync(path).isSymbolicLink() || !lstatSync(path).isDirectory())) {
    throw new Error('Workspace storage must be a private directory, not a redirected path.')
  }
  mkdirSync(path, { recursive: true, mode: 0o700 })
}

function optionalCount(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null
  }
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error('Workspace catalog contains an invalid record.')
  }
  return value
}

function decodeWorkspace(row: Record<string, unknown> | undefined): ProjectWorkspace {
  if (
    !row ||
    !isProjectWorkspaceId(row.id) ||
    typeof row.name !== 'string' ||
    projectWorkspaceName(row.name) !== row.name ||
    (row.kind !== 'existing' && row.kind !== 'isolated') ||
    (row.id === 'existing') !== (row.kind === 'existing') ||
    typeof row.createdAt !== 'number' ||
    typeof row.updatedAt !== 'number'
  ) {
    throw new Error('Workspace catalog contains an invalid record.')
  }
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    repoCount: optionalCount(row.repoCount),
    openedAt: optionalCount(row.openedAt)
  }
}

function hasUpstreamProfile(baseRoot: string): boolean {
  return ['orca-data.json', 'orca-profile-index.json'].some((name) =>
    existsSync(join(baseRoot, name))
  )
}

function createFirstVersion(db: Database.Database): void {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all()
  if (tables.length > 0) {
    throw new Error('Refusing to replace an unrecognized workspace catalog.')
  }
  db.exec(`
    CREATE TABLE workspaces (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL COLLATE NOCASE UNIQUE,
      kind TEXT NOT NULL CHECK(kind IN ('existing','isolated')),
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL
    );
    CREATE TABLE selection (slot INTEGER PRIMARY KEY CHECK(slot = 1),
      workspaceId TEXT NOT NULL REFERENCES workspaces(id));
  `)
  const now = Date.now()
  db.prepare('INSERT INTO workspaces VALUES (?, ?, ?, ?, ?)').run(
    'existing',
    'Existing projects',
    'existing',
    now,
    now
  )
  db.prepare('INSERT INTO selection VALUES (1, ?)').run('existing')
}

// Version 2 adds application home and the per-workspace summary shown on its cards.
function upgradeToSecondVersion(db: Database.Database): void {
  db.exec(`
    CREATE TABLE summary (workspaceId TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
      repoCount INTEGER CHECK(repoCount IS NULL OR repoCount >= 0),
      openedAt INTEGER);
    CREATE TABLE launch (slot INTEGER PRIMARY KEY CHECK(slot = 1),
      atHome INTEGER NOT NULL CHECK(atHome IN (0, 1)));
    INSERT INTO launch VALUES (1, 1);
    PRAGMA user_version = 2;
  `)
}

export class WorkspaceCatalog {
  private readonly db: Database.Database

  constructor(readonly baseRoot: string) {
    const file = join(workspaceCatalogDirectory(baseRoot), 'catalog.db')
    if (existsSync(file) && lstatSync(file).isSymbolicLink()) {
      throw new Error('Workspace catalog cannot be a symbolic link.')
    }
    this.db = new Database(file, { timeout: 5000 })
    try {
      const supported = (version: unknown): boolean =>
        version === 0 || version === 1 || version === 2 || version === SCHEMA_VERSION
      if (!supported(this.db.pragma('user_version', { simple: true }))) {
        throw new Error('Unsupported workspace catalog version. Update Bastion before opening it.')
      }
      this.db.pragma('foreign_keys = ON')
      this.db.pragma('journal_mode = WAL')
      this.db.pragma('synchronous = FULL')
      this.db.exec('BEGIN IMMEDIATE')
      try {
        const lockedVersion = this.db.pragma('user_version', { simple: true })
        if (!supported(lockedVersion)) {
          throw new Error('Unsupported workspace catalog version.')
        }
        if (lockedVersion === 0) {
          createFirstVersion(this.db)
        }
        if (lockedVersion === 0 || lockedVersion === 1) {
          upgradeToSecondVersion(this.db)
        }
        if (lockedVersion !== SCHEMA_VERSION) {
          upgradeIncognitoCatalog(this.db)
        }
        if (lockedVersion === 0 && !hasUpstreamProfile(baseRoot)) {
          // A fresh install has no upstream projects; record that so Home can leave the card out.
          this.db
            .prepare("INSERT INTO summary (workspaceId, repoCount) VALUES ('existing', 0)")
            .run()
        }
        this.list()
        this.selected()
        this.atHome()
        this.db.exec('COMMIT')
      } catch (error) {
        this.db.exec('ROLLBACK')
        throw error
      }
      hardenSqliteDatabaseFiles(file)
    } catch (error) {
      this.db.close()
      throw error
    }
  }

  list(): ProjectWorkspace[] {
    return this.db
      .prepare(
        `SELECT ${WORKSPACE_COLUMNS} WHERE NOT EXISTS (SELECT 1 FROM incognito i WHERE i.workspaceId = w.id) ORDER BY w.createdAt, w.id`
      )
      .all()
      .map(decodeWorkspace)
  }

  get(id: string): ProjectWorkspace {
    if (!isProjectWorkspaceId(id)) {
      throw new Error('Invalid project workspace ID.')
    }
    const row = this.db.prepare(`SELECT ${WORKSPACE_COLUMNS} WHERE w.id = ?`).get(id)
    if (!row) {
      throw new Error('Project workspace no longer exists.')
    }
    return decodeWorkspace(row)
  }

  incognito(): IncognitoCatalog {
    return new IncognitoCatalog(this.db, this)
  }

  selected(): ProjectWorkspace {
    const row = this.db.prepare('SELECT workspaceId FROM selection WHERE slot = 1').get()
    if (!row || typeof row.workspaceId !== 'string') {
      throw new Error('Workspace selection is missing or invalid.')
    }
    return this.get(row.workspaceId)
  }

  atHome(): boolean {
    const row = this.db.prepare('SELECT atHome FROM launch WHERE slot = 1').get()
    if (!row || (row.atHome !== 0 && row.atHome !== 1)) {
      throw new Error('Workspace launch state is missing or invalid.')
    }
    return row.atHome === 1
  }

  create(rawName: unknown): ProjectWorkspace {
    const name = projectWorkspaceName(rawName)
    const id = `workspace-${randomUUID()}`
    const now = Date.now()
    this.db
      .prepare('INSERT INTO workspaces VALUES (?, ?, ?, ?, ?)')
      .run(id, name, 'isolated', now, now)
    return this.get(id)
  }

  rename(id: string, rawName: unknown): void {
    this.get(id)
    const name = projectWorkspaceName(rawName)
    this.db
      .prepare('UPDATE workspaces SET name = ?, updatedAt = ? WHERE id = ?')
      .run(name, Date.now(), id)
  }

  select(id: string): void {
    this.get(id)
    this.db.exec('BEGIN IMMEDIATE')
    try {
      if (this.incognito().get(id)?.deleting) {
        throw new Error('This Incognito task is being deleted.')
      }
      this.db.prepare('UPDATE selection SET workspaceId = ? WHERE slot = 1').run(id)
      this.db.prepare('UPDATE launch SET atHome = 0 WHERE slot = 1').run()
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  enterHome(): void {
    this.db.prepare('UPDATE launch SET atHome = 1 WHERE slot = 1').run()
  }

  markOpened(id: string): void {
    this.get(id)
    this.db
      .prepare(
        'INSERT INTO summary (workspaceId, openedAt) VALUES (?, ?) ON CONFLICT(workspaceId) DO UPDATE SET openedAt = excluded.openedAt'
      )
      .run(id, Date.now())
  }

  recordRepoCount(id: string, repoCount: number): void {
    this.get(id)
    if (!Number.isInteger(repoCount) || repoCount < 0) {
      throw new Error('Invalid repository count.')
    }
    this.db
      .prepare(
        'INSERT INTO summary (workspaceId, repoCount) VALUES (?, ?) ON CONFLICT(workspaceId) DO UPDATE SET repoCount = excluded.repoCount'
      )
      .run(id, repoCount)
  }

  dataRoot(id: string): string {
    const workspace = this.get(id)
    if (workspace.kind === 'existing') {
      return this.baseRoot
    }
    const parent = join(workspaceCatalogDirectory(this.baseRoot), 'data')
    ensurePrivateDirectory(parent)
    const root = join(parent, workspace.id)
    ensurePrivateDirectory(root)
    return root
  }

  homeRoot(): string {
    const root = join(workspaceCatalogDirectory(this.baseRoot), 'home')
    ensurePrivateDirectory(root)
    return root
  }

  close(): void {
    this.db.close()
  }
}
