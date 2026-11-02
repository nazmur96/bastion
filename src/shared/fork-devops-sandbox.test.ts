import { describe, expect, it } from 'vitest'
import { parseShellEnv, sandboxClusterContext, sandboxClusterName } from './fork-devops-sandbox'

describe('parseShellEnv', () => {
  it('reads export lines and strips quotes', () => {
    expect(
      parseShellEnv(
        'export AWS_ENDPOINT_URL="http://localhost:4566"\nexport AWS_ACCESS_KEY_ID=test\n# comment\nAWS_DEFAULT_REGION=\'us-east-1\'\n'
      )
    ).toEqual({
      AWS_ENDPOINT_URL: 'http://localhost:4566',
      AWS_ACCESS_KEY_ID: 'test',
      AWS_DEFAULT_REGION: 'us-east-1'
    })
  })

  it('ignores anything that is not an assignment', () => {
    expect(parseShellEnv('Floci is running\n  \necho hi')).toEqual({})
  })
})

describe('sandbox cluster naming', () => {
  it('names the cluster after the workspace folder', () => {
    expect(sandboxClusterName('/home/me/Projects/podinfo/Podinfo-GitOps/')).toBe(
      'podinfo-gitops-dev'
    )
    expect(sandboxClusterContext('podinfo-dev')).toBe('vcluster-docker_podinfo-dev')
    expect(sandboxClusterName('C:\\work\\my repo')).toBe('my-repo-dev')
  })
})
