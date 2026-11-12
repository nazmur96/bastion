import { expect, it } from 'vitest'
import {
  discoveryFingerprint,
  draftServiceContract,
  parseServiceContract,
  type DiscoverySnapshot
} from './service-knowledge'
import { discoverySourceWanted, groupDiscoveryFacts, sourceFacts } from './discovery-source-facts'

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
    'secret.enc.yaml',
    'k8s/db-secret.yaml',
    'deploy/app-secrets.yml',
    'kubeconfig.yaml'
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

it('applies container rules only to container files and ignores comments', () => {
  const summaries = (path: string, text: string) =>
    sourceFacts(path, text, 'f').map((fact) => fact.summary)
  expect(
    summaries('docs/values.yaml', 'description: |\n  from the start\n  expose 9999\n')
  ).toEqual([])
  expect(
    summaries('compose.yaml', '# example: ${DATABASE_URL}\nservices: {} # ${REDIS_URL}\n')
  ).toEqual([])
  expect(summaries('Dockerfile', 'from alpine\nRUN echo ${HOME}\nEXPOSE 8080/tcp 9090\n')).toEqual([
    'Container base image is declared; inspect its source.',
    'Container declares ports 8080, 9090. Public exposure is unknown.'
  ])
})
it('points the start-script evidence at its declaration line', () => {
  const facts = sourceFacts(
    'package.json',
    '{\n  "scripts": {\n    "start": "node x"\n  }\n}\n',
    'f'
  )
  expect(facts[0].evidence[0].line).toBe(3)
})

it('does not treat pipeline variables as service configuration', () => {
  expect(
    sourceFacts(
      '.github/workflows/release.yml',
      'run: echo ${GITHUB_SHA} ${PODINFO_VERSION}\n',
      'f'
    )
  ).toEqual([])
})
it('collapses repeated statements into one fact with bounded evidence', () => {
  const facts = Array.from({ length: 25 }, (_, index) =>
    sourceFacts(`svc${index}/compose.yaml`, 'env: ${PODINFO_SVC}\n', 'f')
  ).flat()
  const grouped = groupDiscoveryFacts(facts)
  expect(grouped).toHaveLength(1)
  expect(grouped[0].evidence).toHaveLength(20)
  expect(grouped[0].omitted).toBe(5)
})
