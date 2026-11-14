import { describe, expect, it } from 'vitest'
import { sandboxClusterContext, sandboxClusterName } from './fork-devops-sandbox'

describe('sandbox cluster naming', () => {
  it('names the cluster after the workspace folder', () => {
    expect(sandboxClusterName('/home/me/Projects/podinfo/Podinfo-GitOps/')).toBe(
      'podinfo-gitops-dev'
    )
    expect(sandboxClusterContext('podinfo-dev')).toBe('vcluster-docker_podinfo-dev')
    expect(sandboxClusterName('C:\\work\\my repo')).toBe('my-repo-dev')
  })
})
