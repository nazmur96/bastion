import type * as Os from 'node:os'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({ home: '' }))
vi.mock('node:os', async (original) => ({
  ...(await original<typeof Os>()),
  homedir: () => fixture.home
}))
vi.mock('../../../shared/secret-store', () => ({
  getSecretStore: () => ({
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(value),
    decryptString: (value: Buffer) => value.toString('utf8'),
    describeProtectionGap: () => null
  })
}))

const roots: string[] = []
afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

async function stores() {
  vi.resetModules()
  const { createEncryptedApiKeyFileStore } =
    await import('../../credentials/encrypted-api-key-file-store')
  const bitbucket = await import('../../bitbucket/credential-store')
  const jira = await import('../../jira/site-credential-store')
  const linear = await import('../../linear/linear-token-store')
  const cookie = await import('../../minimax/minimax-cookie-store')
  const key = createEncryptedApiKeyFileStore({
    fileName: 'fixture-api-key.enc',
    envelopePrefix: 'fixture:v1:',
    providerLabel: 'Fixture',
    logScope: 'fixture'
  })
  return {
    save(value: string): void {
      key.save(value)
      bitbucket.saveBitbucketCredential({
        accessToken: value,
        apiToken: null,
        authMode: 'token',
        email: null,
        baseUrl: null,
        account: 'synthetic'
      })
      jira.saveToken('same-site', value)
      linear.saveWorkspaceToken('same-organization', value)
      cookie.saveMiniMaxSessionCookie(value)
    },
    read: () => [
      key.read(),
      bitbucket.loadStoredBitbucketSecret({ force: true })?.accessToken ?? null,
      jira.readToken('same-site'),
      linear.loadToken({ force: true, workspaceId: 'same-organization' }),
      cookie.readMiniMaxSessionCookie()
    ],
    clear(): void {
      key.clear()
      bitbucket.clearStoredBitbucketCredential()
      jira.deleteToken('same-site')
      linear.clearTokenFile('same-organization')
      cookie.clearMiniMaxSessionCookie()
    }
  }
}

it('separates save/read/delete across two workspace processes and preserves legacy credentials', async () => {
  const root = mkdtempSync(join(tmpdir(), 'bastion-credentials-'))
  roots.push(root)
  fixture.home = join(root, 'synthetic-home')
  vi.stubEnv('BASTION_PROJECT_WORKSPACE_DATA_ROOT', '')
  ;(await stores()).save('legacy-fixture')
  vi.stubEnv('BASTION_PROJECT_WORKSPACE_DATA_ROOT', join(root, 'workspace-a'))
  expect((await stores()).read()).toEqual(Array(5).fill(null))
  ;(await stores()).save('workspace-a-fixture')
  vi.stubEnv('BASTION_PROJECT_WORKSPACE_DATA_ROOT', join(root, 'workspace-b'))
  expect((await stores()).read()).toEqual(Array(5).fill(null))
  ;(await stores()).save('workspace-b-fixture')
  expect((await stores()).read()).toEqual(Array(5).fill('workspace-b-fixture'))
  ;(await stores()).clear()
  expect((await stores()).read()).toEqual(Array(5).fill(null))
  vi.stubEnv('BASTION_PROJECT_WORKSPACE_DATA_ROOT', join(root, 'workspace-a'))
  expect((await stores()).read()).toEqual(Array(5).fill('workspace-a-fixture'))
  vi.stubEnv('BASTION_PROJECT_WORKSPACE_DATA_ROOT', '')
  expect((await stores()).read()).toEqual(Array(5).fill('legacy-fixture'))
})
