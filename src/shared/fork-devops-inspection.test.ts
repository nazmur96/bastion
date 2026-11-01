import { describe, expect, it } from 'vitest'
import { devopsCommandLine } from './fork-devops-inspection'

describe('devopsCommandLine', () => {
  it('runs the whole command inside mise, nested $(…) included', () => {
    expect(
      devopsCommandLine(
        { tool: 'kubectl', available: true, runner: 'mise', prefix: 'mise exec -- ' },
        `kubectl config get-contexts "$(kubectl config current-context)"`
      )
    ).toBe(`mise exec -- sh -c 'kubectl config get-contexts "$(kubectl config current-context)"'`)
  })

  it('leaves PATH tools and single quotes intact', () => {
    expect(
      devopsCommandLine({ tool: 'gh', available: true, runner: 'path', prefix: '' }, 'gh run list')
    ).toBe('gh run list')
    expect(
      devopsCommandLine(
        { tool: 'helm', available: true, runner: 'mise', prefix: 'mise exec -- ' },
        "helm template 'my chart'"
      )
    ).toBe(`mise exec -- sh -c 'helm template '\\''my chart'\\'''`)
  })
})

describe('devopsCommandLine on Windows', () => {
  it('lets mise run the command directly, since there is no sh', () => {
    expect(
      devopsCommandLine(
        { tool: 'terraform', available: true, runner: 'mise', prefix: 'mise exec -- ' },
        'terraform plan',
        'windows'
      )
    ).toBe('mise exec -- terraform plan')
  })
})
