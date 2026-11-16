import { describe, expect, it } from 'vitest'
import { pinnedDigest, withPinnedDigest } from './kustomize-digest'

const A = `sha256:${'a'.repeat(64)}`
const B = `sha256:${'b'.repeat(64)}`
const config = `apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization
# keep this comment
resources:
  - deployment.yaml
images:
  - name: app
    newName: ghcr.io/example/app
    digest: ${A}
  - name: sidecar
    newName: ghcr.io/example/sidecar
    newTag: "1.2"
`

describe('kustomization digest pinning', () => {
  it('reads the pinned digest for one image', () => {
    expect(pinnedDigest(config, 'app')).toBe(A)
    expect(pinnedDigest(config, 'sidecar')).toBeNull()
  })
  it('changes only that image digest and keeps comments and other entries', () => {
    const next = withPinnedDigest(config, 'app', B)
    expect(pinnedDigest(next, 'app')).toBe(B)
    expect(next).toContain('# keep this comment')
    expect(next).toContain('newTag: "1.2"')
    expect(next.replace(B, A)).toBe(config)
  })
  it('replaces a tag with the digest so the digest is the identity', () => {
    const next = withPinnedDigest(config, 'sidecar', B)
    expect(next).not.toContain('newTag')
    expect(pinnedDigest(next, 'sidecar')).toBe(B)
  })
  it('refuses unknown or duplicated images and invalid digests', () => {
    expect(() => withPinnedDigest(config, 'missing', B)).toThrow('exactly once')
    expect(() => withPinnedDigest(`${config}  - name: app\n    digest: ${A}\n`, 'app', B)).toThrow(
      'exactly once'
    )
    expect(() => withPinnedDigest(config, 'app', 'latest')).toThrow('Invalid digest')
  })
})
