import { randomUUID } from 'node:crypto'
import { existsSync, lstatSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import Database from '../../sqlite/sync-database'
import { hardenSqliteDatabaseFiles } from '../../sqlite/harden-database-files'
import {
  isProjectWorkspaceId,
  projectWorkspaceName,
  type ProjectWorkspace
} from '../../../shared/fork-project-workspaces'

const SCHEMA_VERSION = 1

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
    updatedAt: row.updatedAt
  }
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
      const version = this.db.pragma('user_version', { simple: true })
      if (version !== 0 && version !== SCHEMA_VERSION) {
        throw new Error('Unsupported workspace catalog version. Update Bastion before opening it.')
      }
      this.db.pragma('foreign_keys = ON')
      this.db.pragma('journal_mode = WAL')
      this.db.pragma('synchronous = FULL')
      this.db.exec('BEGIN IMMEDIATE')
      try {
        const lockedVersion = this.db.pragma('user_version', { simple: true })
        if (lockedVersion !== 0 && lockedVersion !== SCHEMA_VERSION) {
          throw new Error('Unsupported workspace catalog version.')
        }
        if (lockedVersion === 0) {
          const tables = this.db
            .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
            .all()
          if (tables.length > 0) {
            throw new Error('Refusing to replace an unrecognized workspace catalog.')
          }
          this.db.exec(`
            CREATE TABLE workspaces (
              id TEXT PRIMARY KEY,
              name TEXT NOT NULL COLLATE NOCASE UNIQUE,
              kind TEXT NOT NULL CHECK(kind IN ('existing','isolated')),
              createdAt INTEGER NOT NULL,
              updatedAt INTEGER NOT NULL
            );
            CREATE TABLE selection (slot INTEGER PRIMARY KEY CHECK(slot = 1),
              workspaceId TEXT NOT NULL REFERENCES workspaces(id));
            PRAGMA user_version = 1;
          `)
          const now = Date.now()
          this.db
            .prepare('INSERT INTO workspaces VALUES (?, ?, ?, ?, ?)')
            .run('existing', 'Existing projects', 'existing', now, now)
          this.db.prepare('INSERT INTO selection VALUES (1, ?)').run('existing')
        }
        this.list()
        this.selected()
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
      .prepare('SELECT id, name, kind, createdAt, updatedAt FROM workspaces ORDER BY createdAt, id')
      .all()
      .map(decodeWorkspace)
  }

  get(id: string): ProjectWorkspace {
    if (!isProjectWorkspaceId(id)) {
      throw new Error('Invalid project workspace ID.')
    }
    const row = this.db
      .prepare('SELECT id, name, kind, createdAt, updatedAt FROM workspaces WHERE id = ?')
      .get(id)
    if (!row) {
      throw new Error('Project workspace no longer exists.')
    }
    return decodeWorkspace(row)
  }

  selected(): ProjectWorkspace {
    const row = this.db.prepare('SELECT workspaceId FROM selection WHERE slot = 1').get()
    if (!row || typeof row.workspaceId !== 'string') {
      throw new Error('Workspace selection is missing or invalid.')
    }
    return this.get(row.workspaceId)
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
    this.db.prepare('UPDATE selection SET workspaceId = ? WHERE slot = 1').run(id)
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

  close(): void {
    this.db.close()
  }
}
