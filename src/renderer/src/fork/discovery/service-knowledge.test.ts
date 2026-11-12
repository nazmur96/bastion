import { expect, it } from 'vitest'
import {
  discoveryFingerprint,
  discoverySourceWanted,
  draftServiceContract,
  parseServiceContract,
  sourceFacts,
  type DiscoverySnapshot
} from './service-knowledge'

it('keeps evidence and reference names without copying secret or startup values', () => {
  const text =
    'FROM private.registry/image\nEXPOSE 8080\nCMD ["sh", "-c", "TOKEN=do-not-copy"]\nenvironment: ${DATABASE_URL:-do-not-copy}\nsecretKeyRef:\n  key: do-not-copy\n'
  const facts = sourceFacts('Dockerfile', text, 'fingerprint')
  expect(JSON.stringify(facts)).not.toContain('do-not-copy')
  expect(facts.some((f) => f.kind === 'inferred' && f.summary.includes('DATABASE_URL'))).toBe(true)
  expect(facts.find((f) => f.id.includes('port'))?.evidence).toEqual([
    { path: 'Dockerfile', line: 2, fingerprint: 'fingerprint' }
  ])
})
it('excludes secret-value files and vendored source from content inspection', () => {
  for (const path of [
    '.env',
    'app/.env.prod',
    'infra/prod.tfvars',
    'secrets/db.yaml',
    'credentials.json',
    'node_modules/lib/package.json',
    'secret.enc.yaml'
  ]) {
    expect(discoverySourceWanted(path), path).toBe(false)
  }
  expect(discoverySourceWanted('deploy/deployment.yaml')).toBe(true)
})
it('does not invent operational answers and preserves saved human knowledge on a new snapshot', () => {
  const snapshot: DiscoverySnapshot = {
    at: '',
    root: '/repo',
    hostId: 'local',
    fingerprint: 'old',
    facts: [],
    findings: [],
    limits: []
  }
  const contract = parseServiceContract(draftServiceContract(snapshot))
  expect(Object.values(contract.answers).every((answer) => answer === null)).toBe(true)
  contract.answers.dataRecovery = 'RPO agreed with service owner: one hour.'
  const saved = JSON.stringify(contract)
  snapshot.fingerprint = 'new'
  expect(parseServiceContract(saved).answers.dataRecovery).toContain('one hour')
  expect(parseServiceContract(saved).sourceFingerprint).not.toBe(snapshot.fingerprint)
})
it('fingerprints change with source edits/additions/removals, independently of listing order', () => {
  const baseline = discoveryFingerprint([
    ['a', 'one'],
    ['b', 'two']
  ])
  expect(
    discoveryFingerprint([
      ['b', 'two'],
      ['a', 'one']
    ])
  ).toBe(baseline)
  expect(
    discoveryFingerprint([
      ['a', 'edited'],
      ['b', 'two']
    ])
  ).not.toBe(baseline)
  expect(discoveryFingerprint([['a', 'one']])).not.toBe(baseline)
})
it('rejects unsupported/malformed contracts without rewriting them', () => {
  for (const value of [
    '{}',
    '{',
    '{"version":2}',
    '{"version":1,"sourceFingerprint":"x","answers":{"owner":42}}'
  ]) {
    expect(() => parseServiceContract(value)).toThrow()
  }
})
