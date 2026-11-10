import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import Database from '../../sqlite/sync-database'
import { resolveProjectWorkspaceCliRoot } from '../../../cli/runtime/project-workspace-root'
import { WorkspaceCatalog } from './workspace-catalog'
import { configureProjectWorkspace, PROJECT_WORKSPACE_LAUNCH_ENV } from './workspace-context'

const roots: string[] = []
function temporary(): string {
  const root = mkdtempSync(join(tmpdir(), 'bastion-home-'))
  roots.push(root)
  return root
}
afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

it('opens application home on a cold launch without moving existing data', () => {
  const root = temporary()
  writeFileSync(join(root, 'legacy-marker'), 'unchanged')
  const paths: Record<string, string> = {}
  const env: NodeJS.ProcessEnv = {}
  const context = configureProjectWorkspace(root, (name, path) => (paths[name] = path), [], env)
  const home = join(root, 'bastion-project-workspaces', 'home')
  expect(context.activeId).toBe('home')
  expect(context.workspace).toBeNull()
  expect(paths).toEqual({ userData: home, sessionData: home })
  expect(env.BASTION_PROJECT_WORKSPACE_DATA_ROOT).toBe(home)
  expect(readFileSync(join(root, 'legacy-marker'), 'utf8')).toBe('unchanged')
  const catalog = new WorkspaceCatalog(root)
  try {
    expect(catalog.list().map((workspace) => workspace.id)).toEqual(['existing'])
    expect(catalog.dataRoot('existing')).toBe(root)
    expect(catalog.atHome()).toBe(true)
  } finally {
    catalog.close()
  }
  expect(resolveProjectWorkspaceCliRoot(root, {})).toBe(home)
})

it('opens the requested workspace for a switch relaunch and forgets the one-shot request', () => {
  const root = temporary()
  const catalog = new WorkspaceCatalog(root)
  try {
    const retail = catalog.create('Retail')
    const env: NodeJS.ProcessEnv = { [PROJECT_WORKSPACE_LAUNCH_ENV]: retail.id }
    const context = configureProjectWorkspace(root, () => {}, [], env)
    expect(context.activeId).toBe(retail.id)
    expect(context.dataRoot).toBe(catalog.dataRoot(retail.id))
    expect(env[PROJECT_WORKSPACE_LAUNCH_ENV]).toBeUndefined()
    expect(catalog.atHome()).toBe(false)
    expect(catalog.selected().id).toBe(retail.id)
    expect(catalog.list().find((row) => row.id === retail.id)?.openedAt).toEqual(expect.any(Number))
    expect(resolveProjectWorkspaceCliRoot(root, {})).toBe(catalog.dataRoot(retail.id))
    expect(() =>
      configureProjectWorkspace(root, () => {}, [], { [PROJECT_WORKSPACE_LAUNCH_ENV]: '../x' })
    ).toThrow()
  } finally {
    catalog.close()
  }
})

it('upgrades a first-version catalog in place and records repository counts for home cards', () => {
  const root = temporary()
  const first = new WorkspaceCatalog(root)
  const retail = first.create('Retail')
  first.close()
  const file = join(root, 'bastion-project-workspaces', 'catalog.db')
  const db = new Database(file)
  db.exec('DROP TABLE summary; DROP TABLE launch; PRAGMA user_version = 1')
  db.close()
  const upgraded = new WorkspaceCatalog(root)
  try {
    expect(upgraded.get(retail.id).name).toBe('Retail')
    expect(upgraded.get(retail.id).repoCount).toBeNull()
    upgraded.recordRepoCount(retail.id, 3)
    expect(upgraded.get(retail.id).repoCount).toBe(3)
    expect(upgraded.atHome()).toBe(true)
  } finally {
    upgraded.close()
  }
})
