import { describe, expect, it } from 'vitest'
import type { DeliveryConfig } from '../../../shared/fork-delivery/delivery-contract'
import { readDeliveryChain, type DeliveryDeps } from './delivery-chain'

const SHA = 'c2ffaa186c0647aaa21ff487811f4e0d1813c919'
const DEPLOY = '5b043200d2d3353aaaaaaaaaaaaaaaaaaaaaaaaa'
const DIGEST = `sha256:${'e'.repeat(64)}`
const OTHER = `sha256:${'f'.repeat(64)}`
const REPO = 'ghcr.io/example/spike'
const config: DeliveryConfig = {
  projectId: 'p',
  repository: 'example/spike',
  workflow: 'build.yml',
  configPath: 'deploy/kustomization.yaml',
  imageName: 'app',
  application: 'spike-app',
  applicationNamespace: 'argocd',
  revision: null
}
const HEALTHY: [string, string] = ['Synced', 'Healthy']
const kustomization = (digest: string) =>
  `images:\n  - name: app\n    newName: ${REPO}\n    digest: ${digest}\n`

function deps(
  overrides: Partial<{
    run: { conclusion: string | null; status?: string } | null
    artifact: string | null
    labels: Record<string, string> | null
    configDigest: string
    sync: [string, string]
    running: string[]
  }> = {}
): DeliveryDeps {
  const o = {
    run: { conclusion: 'success' },
    artifact: JSON.stringify({ revision: SHA, digest: DIGEST }),
    labels: { 'org.opencontainers.image.revision': SHA },
    configDigest: DIGEST,
    sync: HEALTHY,
    running: [DIGEST],
    ...overrides
  }
  return {
    git: async () => ({ ok: true, stdout: `${SHA}\n` }),
    githubApi: async () => ({
      workflow_runs: o.run
        ? [
            {
              id: 43875227069,
              head_sha: SHA,
              status: o.run.status ?? 'completed',
              conclusion: o.run.conclusion,
              created_at: '2026-11-16T10:00:00Z'
            }
          ]
        : []
    }),
    runArtifactFile: async () => o.artifact,
    imageLabels: async () => ({ labels: o.labels, reason: o.labels ? null : 'needs credentials' }),
    readProjectFile: async () => kustomization(o.configDigest),
    kubectl: async (args) =>
      args.includes('applications.argoproj.io')
        ? {
            ok: true,
            code: 'ok',
            out: JSON.stringify({
              spec: { destination: { namespace: 'spike' } },
              status: {
                sync: { status: o.sync[0], revision: DEPLOY },
                health: { status: o.sync[1] }
              }
            })
          }
        : {
            ok: true,
            code: 'ok',
            out: JSON.stringify({
              items: o.running.map((digest) => ({
                status: {
                  containerStatuses: [{ image: `${REPO}@${digest}`, imageID: `${REPO}@${digest}` }]
                }
              }))
            })
          }
  }
}
const statuses = (chain: Awaited<ReturnType<typeof readDeliveryChain>>) =>
  Object.fromEntries(chain.links.map((link) => [link.id, link.status]))

describe('delivery evidence chain', () => {
  it('verifies every link from revision to running pods', async () => {
    const chain = await readDeliveryChain(config, deps())
    expect(statuses(chain)).toEqual({
      revision: 'verified',
      ci: 'verified',
      artifact: 'verified',
      registry: 'verified',
      config: 'verified',
      controller: 'verified',
      running: 'verified'
    })
    expect(chain).toMatchObject({
      revision: SHA,
      digest: DIGEST,
      promotable: true,
      blockedBy: null
    })
    expect(chain.configFingerprint).toMatch(/^sha256:/)
  })
  it('blocks promotion when the check failed, and never shows a digest for it', async () => {
    const chain = await readDeliveryChain(config, deps({ run: { conclusion: 'failure' } }))
    expect(statuses(chain)).toMatchObject({ ci: 'mismatch', artifact: 'unknown' })
    expect(chain).toMatchObject({ promotable: false, blockedBy: 'ci', digest: null })
  })
  it('treats a revision with no CI run as unknown and blocking, never as passing', async () => {
    const chain = await readDeliveryChain(config, deps({ run: null }))
    expect(chain.links.find((link) => link.id === 'ci')).toMatchObject({
      status: 'unknown',
      detail: 'No CI run for this revision'
    })
    expect(chain.promotable).toBe(false)
  })
  it('refuses an artifact that names another revision', async () => {
    const chain = await readDeliveryChain(
      config,
      deps({ artifact: JSON.stringify({ revision: DEPLOY, digest: DIGEST }) })
    )
    expect(statuses(chain).artifact).toBe('mismatch')
    expect(chain.blockedBy).toBe('artifact')
  })
  it('keeps a private registry unknown and blocking; no credentials are used', async () => {
    const chain = await readDeliveryChain(config, deps({ labels: null }))
    expect(chain.links.find((link) => link.id === 'registry')).toMatchObject({
      status: 'unknown',
      detail: 'needs credentials'
    })
    expect(chain.blockedBy).toBe('registry')
  })
  it('shows a config pinning another digest as mismatch while the revision stays promotable', async () => {
    const chain = await readDeliveryChain(config, deps({ configDigest: OTHER, running: [OTHER] }))
    expect(statuses(chain)).toMatchObject({ config: 'mismatch', running: 'mismatch' })
    expect(chain).toMatchObject({ promotable: true, configDigest: OTHER })
  })
  it('finds pods pulled by digest, whose image field is only a local ID', async () => {
    const d = deps()
    const real = d.kubectl
    d.kubectl = async (args) =>
      args.includes('pods')
        ? {
            ok: true,
            code: 'ok',
            out: JSON.stringify({
              items: [
                {
                  status: {
                    containerStatuses: [
                      { image: `sha256:${'6'.repeat(64)}`, imageID: `${REPO}@${DIGEST}` }
                    ]
                  }
                }
              ]
            })
          }
        : real(args)
    const chain = await readDeliveryChain(config, d)
    expect(chain.links.find((link) => link.id === 'running')?.status).toBe('verified')
  })
  it('reports a mid-rollout with two running digests as mismatch', async () => {
    const chain = await readDeliveryChain(config, deps({ running: [DIGEST, OTHER] }))
    expect(statuses(chain).running).toBe('mismatch')
  })
  it('shows an out-of-sync controller as mismatch and an unreadable one as unknown', async () => {
    expect(
      statuses(await readDeliveryChain(config, deps({ sync: ['OutOfSync', 'Healthy'] }))).controller
    ).toBe('mismatch')
    const unreadable = deps()
    unreadable.kubectl = async () => ({ ok: false, out: '', code: 'denied' })
    const chain = await readDeliveryChain(config, unreadable)
    expect(statuses(chain)).toMatchObject({ controller: 'unknown', running: 'unknown' })
  })
})
