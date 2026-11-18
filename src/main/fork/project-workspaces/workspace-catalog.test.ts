import { mkdtempSync, rmSync, mkdirSync, symlinkSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import Database from '../../sqlite/sync-database'
import { WorkspaceCatalog } from './workspace-catalog'
import { configureProjectWorkspace, projectWorkspaceRelaunchArgs } from './workspace-context'
import { resolveProjectWorkspaceCliRoot } from '../../../cli/runtime/project-workspace-root'
import { projectWorkspaceToolEnvironment } from './workspace-tool-environment'
import { isOwnedWorkspaceHistoryPath } from './workspace-history-policy'
import { createdWorkspace, isListedWorkspace } from '../../../shared/fork-project-workspaces'

const roots: string[] = []
function temporary(): string {
  const root = mkdtempSync(join(tmpdir(), 'bastion-workspace-'))
  roots.push(root)
  return root
}
afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('project workspace namespace', () => {
  it('leaves the empty built-in workspace off a fresh install, but keeps it for upgraded profiles', () => {
    const fresh = new WorkspaceCatalog(temporary())
    const upgradedRoot = temporary()
    writeFileSync(join(upgradedRoot, 'orca-profile-index.json'), '{}')
    const upgraded = new WorkspaceCatalog(upgradedRoot)
    try {
      const existing = (catalog: WorkspaceCatalog) =>
        catalog.list().find((workspace) => workspace.kind === 'existing')
      expect(existing(fresh)).toMatchObject({ repoCount: 0, openedAt: null })
      expect(isListedWorkspace(existing(fresh)!)).toBe(false)
      expect(existing(upgraded)).toMatchObject({ repoCount: null })
      expect(isListedWorkspace(existing(upgraded)!)).toBe(true)
      // Create and open: the hidden built-in workspace is not mistaken for the new one.
      const before = fresh.list()
      fresh.create('Real AWS recipe')
      expect(createdWorkspace(before, fresh.list())?.name).toBe('Real AWS recipe')
      // Opening it once lists it again, whatever it holds.
      fresh.markOpened('existing')
      expect(isListedWorkspace(existing(fresh)!)).toBe(true)
    } finally {
      fresh.close()
      upgraded.close()
    }
  })

  it('preserves existing data and persists independent records across catalog writers', () => {
    const root = temporary()
    writeFileSync(join(root, 'legacy-marker'), 'unchanged')
    const first = new WorkspaceCatalog(root)
    const second = new WorkspaceCatalog(root)
    try {
      const a = first.create('Retail store')
      const b = second.create('Platform')
      expect(a.id).not.toBe(b.id)
      expect(first.list().map((row) => row.id)).toEqual(
        expect.arrayContaining([a.id, b.id, 'existing'])
      )
      expect(first.dataRoot('existing')).toBe(root)
      expect(first.dataRoot(a.id)).not.toBe(first.dataRoot(b.id))
      second.rename(a.id, 'Retail production')
      second.select(b.id)
      expect(first.selected().id).toBe(b.id)
      expect(first.get(a.id).name).toBe('Retail production')
      expect(readFileSync(join(root, 'legacy-marker'), 'utf8')).toBe('unchanged')
      expect(() => first.create('platform')).toThrow()
      expect(() => first.create(' \n ')).toThrow()
      expect(() => first.get('../existing')).toThrow()
    } finally {
      first.close()
      second.close()
    }
    const reopened = new WorkspaceCatalog(root)
    try {
      expect(reopened.selected().name).toBe('Platform')
    } finally {
      reopened.close()
    }
  })

  it('selects before startup owners capture paths and does not retarget a running context', () => {
    const root = temporary()
    const catalog = new WorkspaceCatalog(root)
    try {
      const a = catalog.create('A')
      const b = catalog.create('B')
      const paths: Record<string, string> = {}
      const env: NodeJS.ProcessEnv = {}
      const active = configureProjectWorkspace(
        root,
        (name, path) => {
          paths[name] = path
        },
        [`--bastion-project-workspace=${a.id}`],
        env
      )
      expect(paths.userData).toBe(catalog.dataRoot(a.id))
      expect(paths.sessionData).toBe(paths.userData)
      expect(env.BASTION_PROJECT_WORKSPACE_DATA_ROOT).toBe(paths.userData)
      catalog.select(b.id)
      expect(active.activeId).toBe(a.id)
      expect(
        configureProjectWorkspace(root, () => {}, [`--bastion-project-workspace=${b.id}`], {})
          .activeId
      ).toBe(b.id)
      expect(
        projectWorkspaceRelaunchArgs(['.', '--bastion-project-workspace=existing'], b.id)
      ).toEqual(['.', `--bastion-project-workspace=${b.id}`])
      expect(() =>
        configureProjectWorkspace(root, () => {}, ['--bastion-project-workspace=../bad'], {})
      ).toThrow()
    } finally {
      catalog.close()
    }
  })

  it('refuses newer schema and redirected storage rather than opening another workspace', () => {
    const root = temporary()
    const catalog = new WorkspaceCatalog(root)
    const a = catalog.create('A')
    catalog.close()
    const data = join(root, 'bastion-project-workspaces', 'data')
    mkdirSync(data)
    symlinkSync(temporary(), join(data, a.id), 'dir')
    const next = new WorkspaceCatalog(root)
    try {
      expect(() => next.dataRoot(a.id)).toThrow(/redirected/)
    } finally {
      next.close()
    }
    const db = new Database(join(root, 'bastion-project-workspaces', 'catalog.db'))
    db.pragma('user_version = 99')
    db.close()
    expect(() => new WorkspaceCatalog(root)).toThrow(/Unsupported/)
  })

  it('routes external CLI to the selection while keeping launched children pinned', () => {
    const root = temporary()
    const catalog = new WorkspaceCatalog(root)
    try {
      const a = catalog.create('A')
      const b = catalog.create('B')
      const aRoot = catalog.dataRoot(a.id)
      catalog.select(b.id)
      expect(resolveProjectWorkspaceCliRoot(root, {})).toBe(catalog.dataRoot(b.id))
      expect(
        resolveProjectWorkspaceCliRoot(root, {
          ORCA_RUNTIME_SOURCE_ID: 'source',
          ORCA_RUNTIME_SOURCE_INCARNATION: 'old',
          ORCA_RUNTIME_SOURCE_PROFILE_PATH: aRoot
        })
      ).toBe(aRoot)
      expect(
        resolveProjectWorkspaceCliRoot(root, {
          ORCA_RUNTIME_SOURCE_ID: 'foreign',
          ORCA_RUNTIME_SOURCE_INCARNATION: 'x',
          ORCA_RUNTIME_SOURCE_PROFILE_PATH: temporary()
        })
      ).toBe(catalog.dataRoot(b.id))
    } finally {
      catalog.close()
    }
  })

  it('excludes global and symlinked transcripts but retains namespace-owned and legacy history', () => {
    const owned = temporary(),
      foreign = temporary()
    const file = join(owned, 'session.jsonl')
    writeFileSync(file, '{}')
    writeFileSync(join(foreign, 'outside.jsonl'), '{}')
    symlinkSync(foreign, join(owned, 'escape'), 'dir')
    const env = { BASTION_PROJECT_WORKSPACE_DATA_ROOT: owned }
    expect(isOwnedWorkspaceHistoryPath(file, env)).toBe(true)
    expect(isOwnedWorkspaceHistoryPath(join(foreign, 'outside.jsonl'), env)).toBe(false)
    expect(isOwnedWorkspaceHistoryPath(join(owned, 'escape', 'outside.jsonl'), env)).toBe(false)
    expect(isOwnedWorkspaceHistoryPath(join(foreign, 'outside.jsonl'), {})).toBe(true)
    const db = join(owned, 'opencode.db')
    writeFileSync(db, '')
    expect(isOwnedWorkspaceHistoryPath(`${db}#session-id`, env)).toBe(true)
  })

  it('gives child tooling private unconfigured defaults without changing the parent environment', () => {
    const root = temporary()
    const inherited = {
      BASTION_PROJECT_WORKSPACE_DATA_ROOT: root,
      AWS_ACCESS_KEY_ID: 'foreign',
      AWS_PROFILE: 'production',
      KUBECONFIG: '/foreign/kube',
      HOME: '/host/home',
      CODEX_HOME: '/agent'
    }
    const child = projectWorkspaceToolEnvironment(inherited)
    expect(child.AWS_ACCESS_KEY_ID).toBeUndefined()
    expect(child.AWS_PROFILE).toBe('workspace-unconfigured')
    expect(child.KUBECONFIG).toBe(join(root, 'tool-context', 'kubeconfig'))
    expect(child.HOME).toBe(inherited.HOME)
    expect(child.CODEX_HOME).toBe(inherited.CODEX_HOME)
    expect(inherited.AWS_PROFILE).toBe('production')
    expect(projectWorkspaceToolEnvironment({ AWS_PROFILE: 'legacy' }).AWS_PROFILE).toBe('legacy')
  })
})
