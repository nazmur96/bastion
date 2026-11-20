import { z } from 'zod'

/**
 * Fork: Step 14.9 supply-chain evidence for the exact digest a Delivery chain is about to
 * promote. A project opts in with a repository-owned policy; without one nothing changes.
 * Signatures and SBOM attestations are verified with the owner's pinned Cosign. Only an
 * authoritative "does not verify" is a mismatch; anything else is unknown, never verified.
 */
export const SUPPLY_CHAIN_POLICY_PATH = '.bastion/supply-chain.json'

export type SupplyChainStatus = { status: 'verified' | 'mismatch' | 'unknown'; detail: string }
export type SupplyChainEvidence = {
  /** When true, promotion requires a verified signature. */
  requireSignature: boolean
  signature: SupplyChainStatus
  /** Advisory: never blocks promotion. */
  sbom: SupplyChainStatus
}
export type SupplyChainDeps = {
  /** The policy file's text, or null when the project has none. */
  readPolicy: () => Promise<string | null>
  /** Runs the owner's pinned Cosign with these arguments. */
  verify: (args: string[]) => Promise<{ code: number | null; stderr: string }>
}

const DIGEST = /^sha256:[0-9a-f]{64}$/
const REPOSITORY = /^[a-z0-9.-]+(?::\d+)?(?:\/[a-z0-9._-]+)+$/
const keyPath = z
  .string()
  .max(256)
  .regex(/^[A-Za-z0-9_-][A-Za-z0-9._-]*(?:\/[A-Za-z0-9_-][A-Za-z0-9._-]*){0,8}\.pub$/)
const policySchema = z
  .object({
    version: z.literal(1),
    requireSignature: z.boolean().default(false),
    sbomFormat: z.enum(['cyclonedx', 'spdxjson']).default('cyclonedx'),
    trust: z.discriminatedUnion('kind', [
      z
        .object({
          kind: z.literal('keyless'),
          issuer: z.string().url().max(512),
          identity: z.string().min(1).max(512)
        })
        .strict(),
      z.object({ kind: z.literal('key'), publicKey: keyPath }).strict()
    ])
  })
  .strict()
export type SupplyChainPolicy = z.infer<typeof policySchema>

/** Cosign's own words for a check that ran and did not verify. */
const AUTHORITATIVE =
  /no matching (?:signatures|attestations)|none of the expected identities matched|invalid signature|signature mismatch|failed to verify signature/i

function unknown(detail: string): SupplyChainStatus {
  return { status: 'unknown', detail }
}

async function check(
  deps: SupplyChainDeps,
  args: string[],
  label: string
): Promise<SupplyChainStatus> {
  let result
  try {
    result = await deps.verify(args)
  } catch {
    return unknown('Cosign could not run')
  }
  if (result.code === 0) {
    return { status: 'verified', detail: `${label} verified` }
  }
  // Fixed wording only: verifier output can echo registry or token details.
  return AUTHORITATIVE.test(result.stderr)
    ? { status: 'mismatch', detail: `${label} does not verify for this digest and signer` }
    : unknown(
        result.code === null
          ? 'Cosign did not finish'
          : `Cosign could not check (exit ${result.code})`
      )
}

/** Signature and SBOM evidence for `repository@digest`, or null when the project has no policy. */
export async function readSupplyChainEvidence(
  repository: string,
  digest: string,
  deps: SupplyChainDeps,
  resolveKey: (path: string) => string = (path) => path
): Promise<SupplyChainEvidence | null> {
  let text: string | null
  try {
    text = await deps.readPolicy()
  } catch {
    text = ''
  }
  if (text === null) {
    return null
  }
  let policy: SupplyChainPolicy | null = null
  try {
    const parsed = policySchema.safeParse(JSON.parse(text))
    policy = parsed.success ? parsed.data : null
  } catch {
    policy = null
  }
  // An opted-in project whose policy cannot be read fails closed.
  if (!policy) {
    const reason = unknown(`${SUPPLY_CHAIN_POLICY_PATH} is unreadable or invalid`)
    return { requireSignature: true, signature: reason, sbom: reason }
  }
  if (!DIGEST.test(digest) || !REPOSITORY.test(repository)) {
    const reason = unknown('No exact image digest to check')
    return { requireSignature: policy.requireSignature, signature: reason, sbom: reason }
  }
  const reference = `${repository}@${digest}`
  const signer =
    policy.trust.kind === 'keyless'
      ? [
          '--certificate-identity',
          policy.trust.identity,
          '--certificate-oidc-issuer',
          policy.trust.issuer
        ]
      : ['--key', resolveKey(policy.trust.publicKey)]
  const common = [...signer, '--check-claims=true', '--output', 'json']
  const signature = await check(deps, ['verify', ...common, reference], 'Signature')
  const sbom = await check(
    deps,
    ['verify-attestation', '--type', policy.sbomFormat, ...common, reference],
    'SBOM attestation'
  )
  return { requireSignature: policy.requireSignature, signature, sbom }
}
