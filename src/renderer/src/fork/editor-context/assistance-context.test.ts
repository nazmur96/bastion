import { expect, it } from 'vitest'
import {
  assistanceFileAllowed,
  assistanceSourceCurrent,
  boundedAssistanceDraft,
  runtimeAssistanceForFile,
  runtimeAssistanceKey,
  type AssistanceContext
} from './editor-runtime-assistance'
import type { DiscoverySnapshot } from '../discovery/service-knowledge'
const snapshot: DiscoverySnapshot = {
  at: '2026-11-12',
  root: '/app',
  hostId: 'runtime:test',
  fingerprint: 'one',
  findings: [],
  limits: ['bounded'],
  facts: [
    {
      id: 'source',
      kind: 'observed',
      summary: 'do-not-copy-secret-value',
      evidence: [
        { path: 'main.tf', line: 1, fingerprint: 'one' },
        { path: 'credentials.yaml', line: 1, fingerprint: 'secret-value' }
      ]
    }
  ]
}
const ready = { pending: false, changedPaths: [], watchFailed: false }
it('keeps remote CLI status unknown instead of borrowing a local lookup', () => {
  expect(runtimeAssistanceForFile('main.tf', null, true)).toEqual({
    tool: 'terraform',
    available: null
  })
  expect(runtimeAssistanceForFile('Dockerfile', null, true)?.tool).toBe('docker')
  expect(runtimeAssistanceForFile('Chart.yaml', null, true)?.tool).toBe('helm')
})
it('excludes secret-named, absolute, traversal and unbounded paths', () => {
  for (const path of [
    '.env',
    'my-secret.tf',
    'vars.tfvars.json',
    'Credentials/main.tf',
    'config/kubeconfig',
    '../main.tf',
    '/main.tf',
    'C:\\project\\main.tf',
    'a'.repeat(257)
  ]) {
    expect(assistanceFileAllowed(path), path).toBe(false)
  }
})
it('invalidates relevant changed files, runtime config and unknown notifications without unrelated churn', () => {
  expect(assistanceSourceCurrent(snapshot, 'main.tf', ready)).toBe(true)
  for (const changedPaths of [null, ['main.tf'], ['mise.toml'], ['Dockerfile']]) {
    expect(assistanceSourceCurrent(snapshot, 'main.tf', { ...ready, changedPaths })).toBe(false)
  }
  expect(
    assistanceSourceCurrent(snapshot, 'main.tf', { ...ready, changedPaths: ['README.md'] })
  ).toBe(true)
  expect(assistanceSourceCurrent(snapshot, 'main.tf', { ...ready, watchFailed: true })).toBe(false)
})
it('bounds provider text and excludes raw source, summaries, secret evidence and target identity', () => {
  const text = boundedAssistanceDraft('main.tf', { tool: 'terraform', available: null }, snapshot, {
    errors: 999,
    warnings: 999
  })
  expect(text.length).toBeLessThanOrEqual(2400)
  expect(text).toContain('100 errors, 100 warnings')
  expect(text).not.toContain('do-not-copy-secret-value')
  expect(text).not.toContain('credentials.yaml')
  expect(text).not.toContain('/app')
  expect(() =>
    boundedAssistanceDraft('secrets.tf', { tool: 'terraform', available: null }, snapshot, {
      errors: 0,
      warnings: 0
    })
  ).toThrow()
})
it('changes draft identity for file version, editor owner, workspace, runtime, target and diagnostics', () => {
  const context: AssistanceContext = {
    hostId: 'local',
    modelVersion: 1,
    editorOwner: 'one',
    sourceFingerprint: 'one',
    targetSignature: 'one',
    valid: true
  }
  const suggestion = { tool: 'terraform', available: false }
  const baseline = runtimeAssistanceKey('worktree', 'main.tf', suggestion, context)
  for (const patch of [
    { modelVersion: 2 },
    { editorOwner: 'two' },
    { hostId: 'runtime:remote' },
    { targetSignature: 'two' },
    { diagnosticSignature: '1:0' }
  ]) {
    expect(
      runtimeAssistanceKey('worktree', 'main.tf', suggestion, { ...context, ...patch })
    ).not.toBe(baseline)
  }
  expect(runtimeAssistanceKey('other', 'main.tf', suggestion, context)).not.toBe(baseline)
})

it('keeps a partial snapshot usable for an unrelated file and says it is partial', () => {
  const partial = { ...snapshot, limits: ['bounded', 'Not inspected: big-configmap.yaml'] }
  expect(assistanceSourceCurrent(partial, 'main.tf', ready)).toBe(true)
  const draft = boundedAssistanceDraft('main.tf', { tool: 'terraform', available: true }, partial, {
    errors: 0,
    warnings: 0
  })
  expect(draft).toContain('Discovery snapshot is partial')
  expect(draft).not.toContain('big-configmap')
})
