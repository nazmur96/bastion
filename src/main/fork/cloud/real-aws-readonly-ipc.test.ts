import type * as ProcessHost from '@orca/process-host'
import { z } from 'zod'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { registerCloudTargetHandlers } from './cloud-target-ipc'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, raw: unknown) => Promise<unknown>>(),
  quits: new Set<() => void>(),
  trusted: true,
  context: {
    activeId: 'workspace-fixture',
    dataRoot: '',
    workspace: { id: 'workspace-fixture' },
    incognito: false
  },
  spawn: vi.fn(() => {
    throw new Error('Direct child_process execution is forbidden')
  }),
  run: vi.fn(async () => {
    throw new Error('This specification test must not start a process')
  })
}))
vi.mock('electron', () => ({
  app: { once: (_name: string, callback: () => void) => mocks.quits.add(callback) },
  ipcMain: {
    handle: (name: string, handler: (event: unknown, raw: unknown) => Promise<unknown>) =>
      mocks.handlers.set(name, handler)
  }
}))
vi.mock('node:child_process', async (load) => ({
  ...(await load<Record<string, unknown>>()),
  spawn: mocks.spawn,
  execFile: mocks.spawn
}))
vi.mock('@orca/process-host', async (original) => ({
  ...(await original<typeof ProcessHost>()),
  runProcess: mocks.run
}))
vi.mock('../../ipc/ui', () => ({ isTrustedUIRenderer: () => mocks.trusted }))
vi.mock('../project-workspaces/workspace-context', () => ({
  readProjectWorkspaceContext: () => mocks.context
}))
let root: string
const sender = { mainFrame: {}, isDestroyed: () => false, once: vi.fn(), send: vi.fn() }
const event = { sender, senderFrame: sender.mainFrame }
const projectId = 'fixture::/fixture'
const runtime = {
  getRuntimeId: () => 'fixture-runtime',
  resolveRuntimeFileTarget: vi.fn(async () => ({
    executionHostId: 'local',
    worktree: { id: projectId, path: root }
  }))
}
async function request(operation: string, raw: unknown, source = event): Promise<unknown> {
  const handler = mocks.handlers.get(`bastionCloud:${operation}`)
  expect(handler, `9.3 owner handler ${operation} is not implemented`).toBeDefined()
  if (!handler) {
    throw new Error('Missing 9.3 handler')
  }
  return handler(source, raw)
}
let targetId: string
beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'real-aws-spec-'))
  mocks.context = {
    activeId: 'workspace-fixture',
    dataRoot: root,
    workspace: { id: 'workspace-fixture' },
    incognito: false
  }
  mocks.trusted = true
  vi.clearAllMocks()
  registerCloudTargetHandlers(
    {
      getRepos: () => [
        { id: 'fixture', path: root, displayName: 'Fixture', addedAt: 0, badgeColor: '' }
      ],
      getFolderWorkspaces: () => [],
      getProjectGroups: () => []
    },
    runtime
  )
  await request('update', {
    projectId,
    revision: 0,
    mutation: {
      kind: 'add',
      label: 'Fixture real AWS',
      configuration: {
        kind: 'real',
        provider: 'aws',
        profileName: 'fixture-federated',
        region: 'us-east-1'
      }
    }
  })
  const listed = z
    .object({
      ok: z.literal(true),
      snapshot: z.object({ targets: z.array(z.object({ id: z.string().uuid() })).min(1) })
    })
    .parse(await request('read', { projectId }))
  targetId = listed.snapshot.targets[0].id
  await request('update', { projectId, revision: 1, selection: targetId })
  runtime.resolveRuntimeFileTarget.mockClear()
})
afterEach(() => {
  for (const quit of mocks.quits) {
    quit()
  }
  mocks.quits.clear()
  mocks.handlers.clear()
  expect(mocks.spawn).not.toHaveBeenCalled()
  rmSync(root, { recursive: true, force: true })
})

describe('9.3 read-only AWS owner refusals (no AWS or mise execution)', () => {
  it('RA-02 refuses a missing project mise pin before probing host AWS or credentials', async () => {
    expect(await request('verifyRealTarget', { projectId, targetId })).toMatchObject({
      ok: false,
      code: 'tool-unavailable'
    })
    expect(mocks.run).not.toHaveBeenCalled()
  })
  it.each(['ec2:run-instances', 's3:get-object'])(
    'RA-04 refuses caller-selected operation %s before transport',
    async (operation) => {
      expect(
        await request('readRealTarget', {
          projectId,
          targetId,
          requestId: '20000000-0000-4000-8000-000000000001',
          operation
        })
      ).toMatchObject({
        ok: false,
        code: 'invalid'
      })
      expect(mocks.run).not.toHaveBeenCalled()
      expect(runtime.resolveRuntimeFileTarget).not.toHaveBeenCalled()
    }
  )
  it('RA-04 refuses argv, endpoint and credential fields before transport', async () => {
    expect(
      await request('verifyRealTarget', {
        projectId,
        targetId,
        endpoint: 'https://example.invalid',
        argv: ['configure', 'export-credentials'],
        env: { AWS_SECRET_ACCESS_KEY: 'PLANTED_SPEC_MARKER' }
      })
    ).toMatchObject({ ok: false, code: 'invalid' })
    expect(mocks.run).not.toHaveBeenCalled()
  })
  it('RA-09 refuses Cost Explorer without a main-issued consent grant before authentication', async () => {
    expect(
      await request('readRealTarget', {
        projectId,
        targetId,
        operation: 'cost-and-usage',
        requestId: '20000000-0000-4000-8000-000000000001'
      })
    ).toMatchObject({ ok: false, code: 'consent-required' })
    expect(mocks.run).not.toHaveBeenCalled()
  })
  it('RA-01 refuses Home and Incognito before owner or process resolution', async () => {
    Object.assign(mocks.context, { workspace: null })
    expect(await request('verifyRealTarget', { projectId, targetId })).toMatchObject({
      ok: false,
      code: 'workspace'
    })
    Object.assign(mocks.context, { workspace: { id: 'workspace-fixture' }, incognito: true })
    expect(await request('verifyRealTarget', { projectId, targetId })).toMatchObject({
      ok: false,
      code: 'workspace'
    })
    expect(runtime.resolveRuntimeFileTarget).not.toHaveBeenCalled()
    expect(mocks.run).not.toHaveBeenCalled()
  })
  it('RA-01 refuses a child frame before project, tool or credential resolution', async () => {
    expect(
      await request('verifyRealTarget', { projectId, targetId }, { sender, senderFrame: {} })
    ).toMatchObject({ ok: false })
    expect(runtime.resolveRuntimeFileTarget).not.toHaveBeenCalled()
    expect(mocks.run).not.toHaveBeenCalled()
  })
  it('refuses an identity anchor written through the ordinary target update channel', async () => {
    // Only a fresh, main-held observation accepted through acceptRealIdentity may anchor a target.
    const result = await request('update', {
      projectId,
      revision: 2,
      mutation: {
        kind: 'update-real',
        id: targetId,
        configuration: {
          kind: 'real',
          provider: 'aws',
          profileName: 'fixture-federated',
          region: 'us-east-1',
          expectedAccountId: '111111111111'
        }
      }
    })
    expect(result).toMatchObject({ ok: false, code: 'invalid' })
    const listed = z
      .object({
        snapshot: z.object({ targets: z.array(z.object({ configuration: z.unknown() })) })
      })
      .parse(await request('read', { projectId }))
    expect(JSON.stringify(listed.snapshot.targets)).not.toContain('111111111111')
  })
})
