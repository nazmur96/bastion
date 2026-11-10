import { existsSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { isProjectWorkspaceId } from '../../shared/fork-project-workspaces'
import { readRuntimeSourceStamp } from '../../shared/runtime-source-env'

/** No catalog writes or runtime fallback: a CLI must not silently act in the previous workspace. */
export function resolveProjectWorkspaceCliRoot(baseRoot: string, env: NodeJS.ProcessEnv): string {
  // A runtime's children stay pinned even after the app selects another workspace.
  const source = readRuntimeSourceStamp(env)?.profilePath
  if (source) {
    const suffix = relative(resolve(baseRoot), resolve(source))
    const parts = suffix.split(/[\\/]/)
    if (
      !suffix ||
      (parts.length === 2 && parts[0] === 'bastion-project-workspaces' && parts[1] === 'home') ||
      (parts.length === 3 &&
        parts[0] === 'bastion-project-workspaces' &&
        parts[1] === 'data' &&
        isProjectWorkspaceId(parts[2]) &&
        parts[2] !== 'existing')
    ) {
      return source
    }
  }
  const file = join(baseRoot, 'bastion-project-workspaces', 'catalog.db')
  if (!existsSync(file)) {
    return baseRoot
  }
  const db = new DatabaseSync(file, { readOnly: true, timeout: 5000 })
  try {
    const version = db.prepare('PRAGMA user_version').get()?.user_version
    if (version !== 1 && version !== 2) {
      throw new Error('Unsupported project workspace catalog. Update Bastion before using its CLI.')
    }
    // Application home owns its own empty runtime; never fall through to the last workspace.
    if (
      version === 2 &&
      db.prepare('SELECT atHome FROM launch WHERE slot = 1').get()?.atHome === 1
    ) {
      return join(baseRoot, 'bastion-project-workspaces', 'home')
    }
    const row = db
      .prepare(
        'SELECT w.id, w.kind FROM selection s JOIN workspaces w ON w.id = s.workspaceId WHERE s.slot = 1'
      )
      .get()
    if (
      !row ||
      !isProjectWorkspaceId(row.id) ||
      (row.id === 'existing' ? row.kind !== 'existing' : row.kind !== 'isolated')
    ) {
      throw new Error('Project workspace selection is invalid. Open Bastion to recover it.')
    }
    return row.id === 'existing'
      ? baseRoot
      : join(baseRoot, 'bastion-project-workspaces', 'data', row.id)
  } finally {
    db.close()
  }
}
