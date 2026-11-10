import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { assemblePtySpawnEnvDeletions } from '../../ipc/pty/spawn-options-assembly'

it('carries private defaults and credential removals through the daemon spawn request', () => {
  const root = mkdtempSync(join(tmpdir(), 'bastion-daemon-context-'))
  vi.stubEnv('BASTION_PROJECT_WORKSPACE_DATA_ROOT', root)
  try {
    const base = {
      callerEnvToDelete: undefined,
      agentTeamsEnvToDelete: [],
      isDaemonHostSpawn: true,
      connectionId: null,
      skipCodexHomeEnv: false,
      stripInheritedOrcaCodexHome: false,
      codexResumeHomeSelected: false,
      settings: undefined
    }
    const result = assemblePtySpawnEnvDeletions({ ...base, env: undefined })
    expect(result.env?.AWS_PROFILE).toBe('workspace-unconfigured')
    expect(result.env?.KUBECONFIG).toBe(join(root, 'tool-context', 'kubeconfig'))
    expect(result.envToDelete).toContain('AWS_ACCESS_KEY_ID')
    const configured = assemblePtySpawnEnvDeletions({
      ...base,
      env: { AWS_PROFILE: 'declared-target', AWS_ACCESS_KEY_ID: 'explicit-fixture' }
    })
    expect(configured.env?.AWS_PROFILE).toBe('declared-target')
    expect(configured.envToDelete).not.toContain('AWS_ACCESS_KEY_ID')
    const remote = assemblePtySpawnEnvDeletions({
      ...base,
      connectionId: 'remote-fixture',
      env: {}
    })
    expect(remote.env?.KUBECONFIG).toBeUndefined()
  } finally {
    vi.unstubAllEnvs()
    rmSync(root, { recursive: true, force: true })
  }
})
