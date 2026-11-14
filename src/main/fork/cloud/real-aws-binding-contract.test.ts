import { describe, expect, it } from 'vitest'
import { cloudBindingSchema, sameCloudBinding } from '../../../shared/fork-cloud/cloud-binding'
import { changeSnapshotSchema } from '../../../shared/fork-changes/change-contract'
import { getDiskBaselineSignature } from '../../../shared/disk-baseline-signature'

const binding = {
  kind: 'real-aws',
  namespaceId: 'workspace-fixture',
  projectId: 'folder:fixture',
  targetId: '10000000-0000-4000-8000-000000000001',
  selectionGeneration: 3,
  configRevision: 0,
  policyFingerprint: `sha256:${'a'.repeat(64)}`,
  owner: {
    projectId: 'folder:fixture',
    root: '/fixture',
    hostId: 'local',
    routeKey: 'local',
    runtimeId: 'fixture-runtime',
    pairingRevision: 'fixture-registration'
  },
  tool: {
    configFile: 'mise.toml',
    configFingerprint: `sha256:${'b'.repeat(64)}`,
    lockFingerprint: null,
    toolId: 'aws-cli',
    version: '2.40.0',
    executableFingerprint: `sha256:${'c'.repeat(64)}`
  },
  identity: {
    profileName: 'fixture-federated',
    region: 'us-east-1',
    partition: 'aws',
    accountId: '000000000000',
    principalArn: 'arn:aws:sts::000000000000:assumed-role/Fixture/fixture-session',
    principalId: 'AROA00000000000000000:fixture-session',
    roleArn: null
  },
  authorizationGeneration: 1
}

describe('9.3 real AWS binding contracts (red until Part G implementation)', () => {
  it('RA-07 admits a real identity/tool binding without an emulator instance or credentials', () => {
    const parsed = cloudBindingSchema.safeParse(binding)
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.kind).toBe('real-aws')
      expect('instance' in parsed.data).toBe(false)
    }
  })
  it('RA-07 extends the existing Step 8 source snapshot instead of a parallel review record', () => {
    expect(
      changeSnapshotSchema.safeParse({
        adapter: 'source-check/v1',
        ownerRuntimeId: 'fixture-runtime',
        files: [{ path: 'app.json', fingerprint: getDiskBaselineSignature('{}') }],
        cloudBinding: binding
      }).success
    ).toBe(true)
  })
  it('RA-07 distinguishes a fresh selection and an invalidated authentication context', () => {
    const before = cloudBindingSchema.parse(binding)
    expect(
      sameCloudBinding(before, cloudBindingSchema.parse({ ...binding, selectionGeneration: 5 }))
    ).toBe(false)
    expect(
      sameCloudBinding(before, cloudBindingSchema.parse({ ...binding, authorizationGeneration: 2 }))
    ).toBe(false)
  })
})
