import path from 'node:path'
import { z } from 'zod'
import type { ElectronApplication } from '@stablyai/playwright-test'
import { expect, test } from './helpers/orca-app'
import { createRestartSession } from './helpers/orca-restart'
import { seedBastionWorkspace } from './helpers/bastion-workspace'
import {
  cleanupDockerSshHostTarget,
  DOCKER_SSH_HOST_REMOTE_REPO_PATH,
  execDockerSshHostTargetCommand,
  startDockerSshHostTarget
} from './helpers/docker-ssh-host-target'
import { seedRelayEraProfile } from './helpers/orcad-upgrade-profile'
import { convertAndRetain, serverCall } from './helpers/orcad-convert-flow'
import { skipUnlessManagedDockerHost, ORCAD_TEMPLATE } from './helpers/orcad-managed-workspace'

skipUnlessManagedDockerHost()
test('13.2 delivery evidence and diagnosis run on the remote owner with its own tools', async ({
  testRepoPath
}, testInfo) => {
  test.setTimeout(8 * 60_000)
  const target = startDockerSshHostTarget(testInfo)
  const session = createRestartSession(testInfo, {
    ORCA_ORCAD_TEMPLATE_PATH: path.resolve(ORCAD_TEMPLATE ?? '')
  })
  const workspace = seedBastionWorkspace(session.userDataDir, 'Remote cloud fixture')
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
    // A commit that exists only on the remote host: the evidence must name it.
    const remoteHead = execDockerSshHostTargetCommand(
      target,
      `git -C ${remote.repoPath} -c user.name=fixture -c user.email=fixture@example.invalid commit -q --allow-empty -m remote-only && git -C ${remote.repoPath} rev-parse HEAD`
    ).trim()
    const launched = await session.launch({ extraArgs: [workspace.launchArg] })
    app = launched.app
    await convertAndRetain(launched.page, workspace.dataRoot, remote)
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
    const config = {
      projectId: remote.worktreeId,
      repository: 'bastion-example/does-not-exist',
      workflow: 'build.yml',
      configPath: 'deploy/kustomization.yaml',
      imageName: 'app',
      application: 'example-app',
      applicationNamespace: 'argocd',
      revision: null
    }
    const operation = async (name: string, request: unknown) =>
      JSON.parse(
        await serverCall(launched.page, environment.id, 'cloud.operation', {
          worktree: `path:${remote.repoPath}`,
          expectedRoot: remote.repoPath,
          expectedRuntimeId: status.result.runtimeId,
          expectedExecutionHostId: 'local',
          operation: name,
          request
        })
      )

    const evidence = await operation('delivery.evidence', config)
    expect(evidence.result.chain.links[0]).toMatchObject({
      id: 'revision',
      status: 'verified',
      detail: remoteHead.slice(0, 12)
    })
    // The remote host has no gh login or cluster: unknown, never green, nothing read locally.
    expect(evidence.result.chain.promotable).toBe(false)

    const diagnosis = await operation('operations.diagnose', { ...config, logs: false })
    expect(diagnosis.result.diagnosis.namespace).toBeNull()
    expect(diagnosis.result.diagnosis.unknown[0]).toMatch(/^Argo CD Application: /)

    const check = {
      ...config,
      check: { service: 'example-app', port: 8080, path: '/', expect: 'ok' },
      kind: 'check',
      runbook: null
    }
    expect((await operation('operations.verify', check)).result.run).toMatchObject({
      passed: false
    })
    const runs = await operation('operations.runs', { projectId: remote.worktreeId })
    expect(runs.result.runs).toHaveLength(1)

    // Source writes are not admitted on this path: the owner rejects the operation name.
    await expect(
      serverCall(launched.page, environment.id, 'cloud.operation', {
        worktree: `path:${remote.repoPath}`,
        expectedRoot: remote.repoPath,
        expectedRuntimeId: status.result.runtimeId,
        expectedExecutionHostId: 'local',
        operation: 'delivery.promote',
        request: {}
      })
    ).rejects.toThrow(/invalid_argument/)
  } finally {
    try {
      await session.dispose(app)
    } finally {
      cleanupDockerSshHostTarget(target)
    }
  }
})
