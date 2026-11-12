import type { DevopsStackFinding } from '../../../../shared/fork-devops-stacks'
import { getDiskBaselineSignature } from '../../../../shared/disk-baseline-signature'

export const CONTRACT_FILE = 'bastion.service.json'
export const SERVICE_QUESTIONS = [
  {
    id: 'runtime',
    title: 'Runtime and entry point',
    why: 'Deployment needs a reproducible start command.',
    how: 'Review build files and confirm the supported runtime and start command.'
  },
  {
    id: 'network',
    title: 'Network and exposure',
    why: 'A declared port does not establish public access.',
    how: 'Confirm listening ports, ingress, DNS and allowed callers.'
  },
  {
    id: 'storage',
    title: 'Disk and persistence',
    why: 'Ephemeral files disappear when an instance is replaced.',
    how: 'Identify writable paths and what must survive replacement.'
  },
  {
    id: 'lifecycle',
    title: 'Startup and shutdown',
    why: 'Readiness and graceful shutdown protect requests during rollout.',
    how: 'Verify startup, health endpoints, signals and shutdown time.'
  },
  {
    id: 'dependencies',
    title: 'Dependencies',
    why: 'A variable name does not prove a dependency is provisioned.',
    how: 'Confirm datastore/service endpoints, ownership and failure behavior; record references, never credentials.'
  },
  {
    id: 'scaling',
    title: 'Scaling and capacity',
    why: 'Safe replicas and limits depend on measured behavior.',
    how: 'Record resource requirements, concurrency and scaling limits after testing.'
  },
  {
    id: 'dataRecovery',
    title: 'Datastore and recovery limits',
    why: 'Source cannot decide acceptable data loss or downtime.',
    how: 'Agree recovery objectives, backup ownership and restore evidence with the service owner.'
  },
  {
    id: 'configuration',
    title: 'Configuration and secret references',
    why: 'Secrets must be bound securely without entering project knowledge.',
    how: 'Record required names and secret-store references, not values. Leak scanning and binding are separate checks.'
  },
  {
    id: 'owner',
    title: 'Ownership and criticality',
    why: 'Production criticality cannot be inferred from a repository.',
    how: 'Confirm the accountable team, escalation route and service criticality.'
  },
  {
    id: 'runbook',
    title: 'Runbook',
    why: 'Recovery instructions must remain available during an incident.',
    how: 'Link a reviewed operational runbook accessible outside the affected platform.'
  }
] as const
export type ServiceQuestionId = (typeof SERVICE_QUESTIONS)[number]['id']
/** line is null when the evidence is the file as a whole rather than one declaration. */
export type DiscoveryEvidence = { path: string; line: number | null; fingerprint: string }
export type DiscoveryFact = {
  id: string
  kind: 'observed' | 'inferred'
  summary: string
  evidence: DiscoveryEvidence[]
  /** Further occurrences beyond the evidence kept for this fact. */
  omitted?: number
}
export type DiscoverySnapshot = {
  at: string
  root: string
  hostId: string
  fingerprint: string
  facts: DiscoveryFact[]
  findings: DevopsStackFinding[]
  limits: string[]
}
export type ServiceContract = {
  version: 1
  sourceFingerprint: string
  answers: Partial<Record<ServiceQuestionId, string | null>>
}

export function parseServiceContract(text: string): ServiceContract {
  const value: unknown = JSON.parse(text)
  if (
    !value ||
    typeof value !== 'object' ||
    !('version' in value) ||
    value.version !== 1 ||
    !('sourceFingerprint' in value) ||
    typeof value.sourceFingerprint !== 'string' ||
    !('answers' in value) ||
    !value.answers ||
    typeof value.answers !== 'object' ||
    Array.isArray(value.answers)
  ) {
    throw new Error(
      'Invalid service contract. Expected version 1, sourceFingerprint and an answers object.'
    )
  }
  const answers: ServiceContract['answers'] = {}
  for (const question of SERVICE_QUESTIONS) {
    if (!(question.id in value.answers)) {
      continue
    }
    const answer: unknown = Reflect.get(value.answers, question.id)
    if (answer !== null && (typeof answer !== 'string' || answer.length > 8000)) {
      throw new Error(`Invalid answer: ${question.id}`)
    }
    answers[question.id] = typeof answer === 'string' ? answer : null
  }
  return { version: 1, sourceFingerprint: value.sourceFingerprint, answers }
}

export function draftServiceContract(snapshot: DiscoverySnapshot): string {
  return `${JSON.stringify(
    {
      version: 1,
      sourceFingerprint: snapshot.fingerprint,
      answers: Object.fromEntries(SERVICE_QUESTIONS.map((q) => [q.id, null]))
    },
    null,
    2
  )}\n`
}

export function discoveryFingerprint(versions: readonly [string, string][]): string {
  return getDiskBaselineSignature(
    JSON.stringify([...versions].sort(([a], [b]) => a.localeCompare(b)))
  )
}
