import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { discoverFiles } from '../../ai-vault/session-scanner-discovery'
import { opencodeDiscoveries } from '../../ai-vault/session-scanner-opencode-sources'
import { zcodeDiscoveries } from '../../ai-vault/session-scanner-zcode-sources'

const roots: string[] = []
function temporary(): string {
  const root = mkdtempSync(join(tmpdir(), 'bastion-history-'))
  roots.push(root)
  return root
}
afterEach(() => {
  vi.unstubAllEnvs()
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})
it('excludes foreign directory and SQLite history sources before discovery and still finds owned transcripts', async () => {
  const owned = temporary(),
    foreign = temporary()
  writeFileSync(join(owned, 'owned.jsonl'), '{}')
  writeFileSync(join(foreign, 'foreign.jsonl'), '{}')
  vi.stubEnv('BASTION_PROJECT_WORKSPACE_DATA_ROOT', owned)
  const scan = (rootDir: string) =>
    discoverFiles({ rootDir, limit: 10, agent: 'claude', issues: [], extensions: ['.jsonl'] })
  expect((await scan(foreign)).files).toEqual([])
  expect((await scan(owned)).files.map((file) => file.path)).toEqual([join(owned, 'owned.jsonl')])
  expect(
    opencodeDiscoveries(
      { opencodeStorageDir: foreign, opencodeDbPaths: [join(foreign, 'opencode.db')] },
      [],
      10,
      []
    )
  ).toEqual([])
  expect(zcodeDiscoveries({ zcodeDbPath: join(foreign, 'db.sqlite') }, [], 10, [])).toEqual([])
})
