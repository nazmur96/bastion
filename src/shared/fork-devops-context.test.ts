import { describe, expect, it } from 'vitest'
import { devopsTone, parseAwsRegion, parseKubeContext } from './fork-devops-context'

const KUBECONFIG = `apiVersion: v1
clusters:
- cluster:
    server: https://127.0.0.1:6443
  name: kind-dev
contexts:
- context:
    cluster: kind-dev
    user: kind-dev
    namespace: podinfo
  name: kind-dev
- context:
    cluster: eks
    user: eks
  name: arn:aws:eks:eu-central-1:750702271569:cluster/prod
current-context: kind-dev
kind: Config
users: []
`

describe('parseKubeContext', () => {
  it('reads the current context and its namespace', () => {
    expect(parseKubeContext(KUBECONFIG)).toEqual({ context: 'kind-dev', namespace: 'podinfo' })
  })

  it('handles a context without a namespace, and no context at all', () => {
    const eks = KUBECONFIG.replace(
      'current-context: kind-dev',
      'current-context: arn:aws:eks:eu-central-1:750702271569:cluster/prod'
    )
    expect(parseKubeContext(eks)).toEqual({
      context: 'arn:aws:eks:eu-central-1:750702271569:cluster/prod'
    })
    expect(parseKubeContext('apiVersion: v1\n')).toBeNull()
  })
})

describe('parseAwsRegion', () => {
  const config =
    '[default]\nregion = us-east-1\n\n[profile authentik]\nregion = eu-central-1\ncredential_process = x\n'
  it('reads a named profile and the default', () => {
    expect(parseAwsRegion(config, 'authentik')).toBe('eu-central-1')
    expect(parseAwsRegion(config, 'default')).toBe('us-east-1')
    expect(parseAwsRegion(config, 'missing')).toBeUndefined()
  })
})

describe('devopsTone', () => {
  it('marks local sandboxes green and prod-looking names red', () => {
    expect(devopsTone('vcluster-docker_podinfo-dev', true)).toBe('local')
    expect(devopsTone('arn:aws:eks:eu-central-1:1:cluster/prod')).toBe('prod')
    expect(devopsTone('production-eu')).toBe('prod')
    expect(devopsTone('product-team')).toBe('normal')
    expect(devopsTone('kind-dev')).toBe('normal')
  })
})
