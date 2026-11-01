import { describe, expect, it } from 'vitest'
import { devopsSuggestionsForText } from './fork-devops-suggestions'
import { rankDevopsActions } from './fork-devops-actions'
import { detectDevopsStacks } from './fork-devops-stacks'

const MANIFEST = 'apiVersion: v1\nkind: Service\n'
const available = rankDevopsActions({
  findings: detectDevopsStacks(
    ['infra/main.tf', 'deploy/svc.yaml', '.github/workflows/ci.yml'],
    (p) => (p === 'deploy/svc.yaml' ? MANIFEST : null)
  )
})
const ids = (text: string) =>
  devopsSuggestionsForText(text, available).map((item) => item.action.id)

describe('devopsSuggestionsForText', () => {
  it('offers what a reply points at, in its order', () => {
    expect(ids('The CI check failed. Run terraform plan to see the change.')).toEqual([
      'ci.failed',
      'terraform.plan'
    ])
    expect(ids('The podinfo pod is in CrashLoopBackOff.')).toEqual(['kubernetes.pods'])
    expect(ids('Run terraform plan -refresh-only to see the drift.')).toEqual(['terraform.drift'])
  })

  it('never offers an action this workspace lacks, and stays quiet otherwise', () => {
    expect(ids('Run helm lint on the chart.')).toEqual([])
    expect(ids('I renamed the variable and updated the README.')).toEqual([])
  })

  it('caps the chips at three', () => {
    expect(
      ids('terraform init, terraform validate, terraform fmt, then terraform plan.')
    ).toHaveLength(3)
  })
})
