import { describe, expect, it, vi } from 'vitest'
import { readSupplyChainEvidence } from './supply-chain-evidence'

const repository = 'ghcr.io/example/image'
const digest = `sha256:${'7'.repeat(64)}`
const issuer = 'https://token.actions.githubusercontent.com'
const identity = 'https://github.com/example/release/.github/workflows/build.yml@refs/heads/main'
const configured = JSON.stringify({
  version: 1,
  requireSignature: true,
  sbomFormat: 'cyclonedx',
  trust: { kind: 'keyless', issuer, identity }
})

describe('Delivery supply-chain evidence', () => {
  it('binds both verifier calls to the exact digest and signer', async () => {
    const verify = vi.fn(async (_args: string[]) => ({ code: 0, stderr: '' }))
    const result = await readSupplyChainEvidence(repository, digest, {
      readPolicy: async () => configured,
      verify
    })
    expect(verify).toHaveBeenCalledTimes(2)
    for (const [args] of verify.mock.calls) {
      expect(args).toContain(`${repository}@${digest}`)
      expect(args).toContain(identity)
      expect(args).toContain(issuer)
      expect(args).toContain('--check-claims=true')
    }
    expect(verify.mock.calls.map(([args]) => args[0])).toEqual(['verify', 'verify-attestation'])
    expect(result).toMatchObject({
      requireSignature: true,
      signature: { status: 'verified' },
      sbom: { status: 'verified' }
    })
  })

  it('treats only authoritative verification failures as mismatches', async () => {
    const result = await readSupplyChainEvidence(repository, digest, {
      readPolicy: async () => configured,
      verify: async (args) =>
        args[0] === 'verify'
          ? { code: 12, stderr: 'no matching signatures' }
          : { code: 1, stderr: '503 registry unavailable with secret-output' }
    })
    expect(result).toMatchObject({
      signature: { status: 'mismatch' },
      sbom: { status: 'unknown' }
    })
    expect(JSON.stringify(result)).not.toContain('secret-output')
  })

  it('keeps an unconfigured project unchanged and fails closed on an invalid policy or digest', async () => {
    const verify = vi.fn()
    expect(
      await readSupplyChainEvidence(repository, digest, { readPolicy: async () => null, verify })
    ).toBeNull()
    expect(
      await readSupplyChainEvidence(repository, digest, {
        readPolicy: async () =>
          '{"version":1,"trust":{"kind":"key","publicKey":"private material"}}',
        verify
      })
    ).toMatchObject({ requireSignature: true, signature: { status: 'unknown' } })
    expect(
      await readSupplyChainEvidence(repository, 'latest', {
        readPolicy: async () => configured,
        verify
      })
    ).toMatchObject({ requireSignature: true, signature: { status: 'unknown' } })
    expect(verify).not.toHaveBeenCalled()
  })
})
