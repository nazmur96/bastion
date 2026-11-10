import { homedir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { integrationCredentialDirectory } from './workspace-credential-directory'

it('keeps integration sign-ins inside an isolated workspace and leaves Existing projects on ~/.orca', () => {
  expect(
    integrationCredentialDirectory({ BASTION_PROJECT_WORKSPACE_DATA_ROOT: '/data/ws-a' })
  ).toBe(join('/data/ws-a', 'integration-credentials'))
  expect(integrationCredentialDirectory({})).toBe(join(homedir(), '.orca'))
})
