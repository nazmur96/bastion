import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { WorkspaceCatalog } from './workspace-catalog'
import { ProfileStateSqliteAuthority } from '../../persistence/profile-state/profile-state-sqlite-authority'
import { buildProfileStateCutoverFixture } from '../../persistence/profile-state-cutover-fixture'
import { getDefaultPersistedState } from '../../../shared/constants'

vi.mock('electron', () => ({
  app: {
    getPath: () => tmpdir(),
    getName: () => 'workspace-test',
    getVersion: () => '0.0.0',
    isPackaged: false,
    on: () => {},
    whenReady: () => Promise.resolve()
  },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (v: string) => Buffer.from(v),
    decryptString: (v: Buffer) => v.toString()
  },
  ipcMain: { on: () => {}, handle: () => {} },
  BrowserWindow: { getAllWindows: () => [] }
}))
vi.mock('../../telemetry/client', () => ({ track: vi.fn() }))
vi.mock('../../telemetry/cohort-classifier', () => ({
  getCohortAtEmit: vi.fn(() => ({ nth_repo_added: 2 }))
}))
vi.mock('../../ssh/config/ssh-config-parser', () => ({
  loadUserSshConfig: vi.fn(() => ({ hosts: [] })),
  sshConfigHostsToTargets: vi.fn(() => [])
}))
const { Store } = await import('../../persistence')
const roots: string[] = []
const authorities: ProfileStateSqliteAuthority[] = []
afterEach(async () => {
  for (const authority of authorities.splice(0)) {
    authority.close()
    await authority.drainBackups()
  }
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

it('persists and reopens complete workbench state in two independent databases, including colliding inner IDs', () => {
  const base = mkdtempSync(join(tmpdir(), 'bastion-state-'))
  roots.push(base)
  const catalog = new WorkspaceCatalog(base)
  try {
    const a = catalog.create('Retail'),
      b = catalog.create('Platform')
    const aRoot = catalog.dataRoot(a.id),
      bRoot = catalog.dataRoot(b.id)
    function authority(root: string): ProfileStateSqliteAuthority {
      const result = new ProfileStateSqliteAuthority(join(root, 'profile-state.db'), 'local')
      authorities.push(result)
      return result
    }
    const aDb = authority(aRoot),
      bDb = authority(bRoot)
    // Existing full fixture covers multiple repos, terminal/agent rows, browser history,
    // labels/tasks, automations, remote targets and host-partitioned sessions.
    const aFixture = buildProfileStateCutoverFixture()
    aFixture.worktreeMeta['repo-local::/fixture/local'].displayName = 'Retail task label'
    aFixture.worktreeMeta['repo-local::/fixture/local'].workspaceStatus = 'in-progress'
    aFixture.automations[0].prompt = 'Retail automation proof'
    aFixture.workspaceSession.openFilesByWorktree = {
      'repo-local::/fixture/local': [
        {
          filePath: '/fixture/local/main.tf',
          relativePath: 'main.tf',
          worktreeId: 'repo-local::/fixture/local',
          language: 'terraform',
          dirtyDraftContent: 'retail draft'
        }
      ]
    }
    aDb.writeSerializedState(Buffer.from(JSON.stringify(aFixture)))
    bDb.writeSerializedState(Buffer.from(JSON.stringify(getDefaultPersistedState('/fixture/home'))))
    const empty = new Store({ dataFile: join(bRoot, 'orca-data.json'), profileStateAuthority: bDb })
    expect(empty.getRepos()).toEqual([])
    expect(empty.getWorkspaceSession().tabsByWorktree).toEqual({})
    expect(empty.getWorkspaceSession().openFilesByWorktree ?? {}).toEqual({})
    empty.freezeWrites()
    const bFixture = buildProfileStateCutoverFixture()
    bFixture.worktreeMeta['repo-local::/fixture/local'].displayName = 'Platform task label'
    bFixture.automations[0].prompt = 'Platform automation proof'
    bFixture.repos = bFixture.repos.map((repo) => ({
      ...repo,
      path: repo.path.replace('/fixture/', '/platform/'),
      displayName: `Platform ${repo.displayName}`
    }))
    bDb.writeSerializedState(Buffer.from(JSON.stringify(bFixture)))
    aDb.close()
    bDb.close()
    const reopenedA = authority(aRoot),
      reopenedB = authority(bRoot)
    const storeA = new Store({
      dataFile: join(aRoot, 'orca-data.json'),
      profileStateAuthority: reopenedA
    })
    const storeB = new Store({
      dataFile: join(bRoot, 'orca-data.json'),
      profileStateAuthority: reopenedB
    })
    expect(storeA.getRepos()).toHaveLength(2)
    expect(storeB.getRepos()).toHaveLength(2)
    expect(storeA.getRepos()[0].path).toBe('/fixture/local')
    expect(storeB.getRepos()[0].path).toBe('/platform/local')
    expect(storeA.getWorkspaceSession().openFilesByWorktree).toMatchObject(
      aFixture.workspaceSession.openFilesByWorktree ?? {}
    )
    expect(storeB.getWorkspaceSession().openFilesByWorktree ?? {}).toEqual({})
    storeA.updateSettings({ terminalFontSize: 21 })
    storeA.flushOrThrow()
    expect(storeB.getSettings().terminalFontSize).not.toBe(21)
    const aState = reopenedA.readSerializedState()
    const bState = reopenedB.readSerializedState()
    expect(aState).toContain('retail draft')
    expect(bState).not.toContain('retail draft')
    expect(aState).toContain('Retail task label')
    expect(aState).not.toContain('Platform task label')
    expect(bState).toContain('Platform task label')
    expect(bState).not.toContain('Retail task label')
    expect(aState).toContain('Retail automation proof')
    expect(aState).not.toContain('Platform automation proof')
    expect(bState).toContain('Platform automation proof')
    expect(bState).not.toContain('Retail automation proof')
    expect(aState).toContain('automation-fixture')
    expect(bState).toContain('automation-fixture')
    storeA.freezeWrites()
    storeB.freezeWrites()
  } finally {
    catalog.close()
  }
})
