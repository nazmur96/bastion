import { expect, it, vi } from 'vitest'
import {
  firstCurrentAssistanceCase,
  type AssistanceCase,
  type AssistanceInputs
} from './assistance-cases'

type Sources = {
  discovery: { observed: boolean }
  terminal: { failed: boolean }
  cloudTarget: { known: boolean }
}
const evaluate = vi.fn((_inputs: AssistanceInputs<Sources>) => 'review-only')
const candidate: AssistanceCase<Sources, string> = {
  id: 'external-source-review',
  inputs: ['discovery', 'terminal'],
  evaluate
}
const inputs: AssistanceInputs<Sources> = {
  discovery: { current: true, revision: 'd1', value: { observed: true } },
  terminal: { current: true, revision: 't1', value: { failed: true } }
}

it('skips a case when any declared source is missing or stale', () => {
  evaluate.mockClear()
  expect(firstCurrentAssistanceCase([candidate], { discovery: inputs.discovery })).toBeNull()
  expect(
    firstCurrentAssistanceCase([candidate], {
      ...inputs,
      terminal: { current: false, revision: 't1', value: { failed: true } }
    })
  ).toBeNull()
  expect(evaluate).not.toHaveBeenCalled()
})
it('accepts additive source names without changing the evaluator or any existing case', () => {
  expect(firstCurrentAssistanceCase([candidate], inputs)?.suggestion).toBe('review-only')
  const later: AssistanceCase<Sources, string> = {
    id: 'future-cloud-review',
    inputs: ['cloudTarget'],
    evaluate: () => 'cloud-review'
  }
  expect(firstCurrentAssistanceCase([later, candidate], inputs)?.caseId).toBe(candidate.id)
  expect(
    firstCurrentAssistanceCase([later, candidate], {
      ...inputs,
      cloudTarget: { current: true, revision: 'c1', value: { known: true } }
    })?.caseId
  ).toBe(later.id)
})
it('stamps only declared source revisions, never source values, so dependent drafts invalidate', () => {
  const first = firstCurrentAssistanceCase([candidate], inputs)
  const changed = firstCurrentAssistanceCase([candidate], {
    ...inputs,
    terminal: { current: true, revision: 't2', value: { failed: true } }
  })
  expect(changed?.inputSignature).not.toBe(first?.inputSignature)
  const unrelated = firstCurrentAssistanceCase([candidate], {
    ...inputs,
    cloudTarget: { current: true, revision: 'c2', value: { known: true } }
  })
  expect(unrelated?.inputSignature).toBe(first?.inputSignature)
  expect(evaluate.mock.calls.at(-1)?.[0]).not.toHaveProperty('cloudTarget')
  expect(first?.inputSignature).not.toContain('observed')
  expect(first?.inputSignature).not.toContain('failed')
})
