import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { ElectronApplication } from '@stablyai/playwright-test'
import { expect, test } from './helpers/orca-app'
import { createRestartSession } from './helpers/orca-restart'
import { seedBastionWorkspace } from './helpers/bastion-workspace'
import {
  cleanupDockerSshHostTarget,
  DOCKER_SSH_HOST_REMOTE_REPO_PATH,
  startDockerSshHostTarget,
  writeDockerSshHostTargetFile
} from './helpers/docker-ssh-host-target'
import { seedRelayEraProfile } from './helpers/orcad-upgrade-profile'
import { convertAndRetain, serverCall } from './helpers/orcad-convert-flow'
import { skipUnlessManagedDockerHost, ORCAD_TEMPLATE } from './helpers/orcad-managed-workspace'
import { getDiskBaselineSignature } from '../../src/shared/disk-baseline-signature'

skipUnlessManagedDockerHost()
test('targetless source checks still execute on a managed SSH owner without a cloud binding', async ({
  testRepoPath
}, testInfo) => {
  test.setTimeout(8 * 60_000)
  const target = startDockerSshHostTarget(testInfo)
  const session = createRestartSession(testInfo, {
    ORCA_ORCAD_TEMPLATE_PATH: path.resolve(ORCAD_TEMPLATE ?? '')
  })
  const workspace = seedBastionWorkspace(session.userDataDir, 'Remote source fixture')
  let app: ElectronApplication | undefined
  try {
    const first = await session.launch({ extraArgs: [workspace.launchArg] })
    app = first.app
    await session.close(app)
    app = undefined
    const remote = seedRelayEraProfile(
      workspace.dataRoot,
      {
        label: 'Disposable SSH fixture',
        host: target.host,
        port: target.port,
        username: 'root',
        identityFile: target.identityFile,
        identitiesOnly: true
      },
      { repoPath: DOCKER_SSH_HOST_REMOTE_REPO_PATH, folderPath: '/tmp' }
    )
    expect(remote.repoPath).not.toBe(testRepoPath)
    writeDockerSshHostTargetFile(target, `${remote.repoPath}/bastion-check.json`, '{}')
    const launched = await session.launch({ extraArgs: [workspace.launchArg] })
    app = launched.app
    await convertAndRetain(launched.page, workspace.dataRoot, remote)
    const cloud = await launched.page.evaluate(
      (id) => window.api.cloudTargets?.read(id),
      remote.worktreeId
    )
    expect(cloud).toMatchObject({
      ok: true,
      snapshot: { owner: 'unavailable', targets: [], selection: null }
    })
    const environments = await launched.page.evaluate(() => window.api.runtimeEnvironments.list())
    const environment = environments.find(
      (entry) =>
        entry.orcadDeployment &&
        entry.orcadDeployment.kind !== 'wsl' &&
        entry.orcadDeployment.sshTargetId === remote.targetId
    )
    if (!environment) {
      throw new Error('Managed fixture environment missing')
    }
    const status = z
      .object({ result: z.object({ runtimeId: z.string() }) })
      .parse(JSON.parse(await serverCall(launched.page, environment.id, 'status.get')))
    const query = {
      worktree: `path:${remote.repoPath}`,
      runId: randomUUID(),
      expectedRoot: remote.repoPath,
      expectedRuntimeId: status.result.runtimeId,
      expectedExecutionHostId: 'local'
    }
    const response = await serverCall(launched.page, environment.id, 'changes.execute', {
      ...query,
      snapshot: {
        adapter: 'source-check/v1',
        ownerRuntimeId: status.result.runtimeId,
        files: [{ path: 'bastion-check.json', fingerprint: getDiskBaselineSignature('{}') }]
      }
    })
    expect(response).not.toContain('cloudBinding')
    await expect
      .poll(
        async () =>
          JSON.parse(await serverCall(launched.page, environment.id, 'changes.get', query)),
        { timeout: 30_000 }
      )
      .toMatchObject({
        result: {
          status: 'passed',
          verification: { code: 'unchanged' },
          steps: [{ path: 'bastion-check.json', code: 'json-valid' }]
        }
      })
  } finally {
    try {
      await session.dispose(app)
    } finally {
      cleanupDockerSshHostTarget(target)
    }
  }
})
