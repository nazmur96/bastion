import { describe, expect, it } from 'vitest'
import {
  classifyKubectlFailure,
  clusterEvidenceLine,
  kubeconfigSource
} from './fork-devops-kube-evidence'

describe('kubectl results that cannot read as empty', () => {
  it.each([
    [
      'Error from server (Forbidden): events is forbidden: User "dev" cannot list resource "events"',
      'denied'
    ],
    ['error: You must be logged in to the server (Unauthorized)', 'denied'],
    ['Unable to connect to the server: dial tcp 10.0.0.1:443: i/o timeout', 'unreachable'],
    ['The connection to the server localhost:8080 was refused', 'unreachable'],
    ['error: current-context is not set', 'no-context'],
    ['error: context "prod" does not exist', 'no-context'],
    ['error: something unexpected', 'failed']
  ])('classifies %j as %s', (stderr, code) => {
    expect(classifyKubectlFailure(stderr, false)).toBe(code)
  })
  it('treats a killed slow call as a timeout whatever it printed', () => {
    expect(classifyKubectlFailure('Error from server (Forbidden)', true)).toBe('timeout')
  })
  it('names where the kubeconfig came from without reading it', () => {
    expect(kubeconfigSource({ KUBECONFIG: '/repo/.kube/config' }, {})).toBe('project')
    expect(kubeconfigSource({}, { KUBECONFIG: '/elsewhere/config' })).toBe('inherited')
    expect(kubeconfigSource({}, {})).toBe('default')
    // The project's own setting wins over an inherited one.
    expect(kubeconfigSource({ KUBECONFIG: '/repo/k' }, { KUBECONFIG: '/x' })).toBe('project')
  })
  it('describes unknown cluster evidence with its context and kubeconfig source', () => {
    expect(
      clusterEvidenceLine({
        status: 'denied',
        context: 'kind-dev',
        kubeconfig: 'default',
        runner: 'path'
      })
    ).toBe(
      'Cluster warnings unknown: access denied · context kind-dev · your default kubeconfig · host kubectl'
    )
    expect(
      clusterEvidenceLine({
        status: 'ok',
        context: 'kind-dev',
        kubeconfig: 'project',
        runner: 'mise'
      })
    ).toBe('Cluster warnings read · context kind-dev · project kubeconfig · project kubectl')
  })
})
