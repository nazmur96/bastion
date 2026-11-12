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

export function discoverySourceWanted(path: string): boolean {
  if (/(^|\/)(node_modules|vendor|dist|build|\.git|\.terraform|\.venv)\//.test(path)) {
    return false
  }
  // Anywhere in the path: Kubernetes Secret manifests and kubeconfigs are rarely named secret.yaml.
  if (
    /(^|\/)\.env[^/]*$|\.tfvars$|\.enc\.[^/]+$|secret|credential|kubeconfig|htpasswd/i.test(path)
  ) {
    return false
  }
  return /(^|\/)(Dockerfile(?:\.[^/]+)?|Containerfile|package\.json|pyproject\.toml|go\.mod|Cargo\.toml|Procfile|(?:docker-)?compose[^/]*\.ya?ml|Chart\.yaml|[^/]+\.tf|[^/]+\.ya?ml)$/.test(
    path
  )
}

const DOCKERFILE = /(^|\/)(Dockerfile(\.[^/]+)?|Containerfile)$/
const YAML = /\.ya?ml$/
// Shell and build variables, not service configuration.
const SHELL_VARIABLES = new Set([
  'HOME',
  'PATH',
  'PWD',
  'USER',
  'SHELL',
  'HOSTNAME',
  'TMPDIR',
  'LANG',
  'TERM'
])

/** The declaration part of a line: full-line and trailing comments never count as evidence. */
function codeOf(path: string, line: string): string {
  if (/(^|\/)package\.json$/.test(path)) {
    return line
  }
  const trimmed = line.trimStart()
  const terraform = path.endsWith('.tf')
  if (trimmed.startsWith('#') || (terraform && trimmed.startsWith('//'))) {
    return ''
  }
  return line.split(terraform ? /\s(?:#|\/\/)/ : /\s#/)[0]
}

export function sourceFacts(path: string, text: string, fingerprint: string): DiscoveryFact[] {
  const lines = text.split('\n')
  const facts: DiscoveryFact[] = []
  const dockerfile = DOCKERFILE.test(path)
  const yaml = YAML.test(path)
  const add = (id: string, kind: DiscoveryFact['kind'], summary: string, line: number): void => {
    if (facts.some((fact) => fact.id === `${path}:${id}:${line}`)) {
      return
    }
    facts.push({
      id: `${path}:${id}:${line}`,
      kind,
      summary,
      evidence: [{ path, line, fingerprint }]
    })
  }
  lines.forEach((raw, index) => {
    const number = index + 1
    const line = codeOf(path, raw)
    if (!line.trim()) {
      return
    }
    if (dockerfile) {
      const expose = line.match(/^\s*EXPOSE\s+(.+)$/i)
      const ports = expose?.[1]
        .split(/\s+/)
        .map((token) => token.match(/^(\d+)(?:\/(?:tcp|udp))?$/i)?.[1])
        .filter((port): port is string => Boolean(port))
      if (ports && ports.length > 0) {
        add(
          'port',
          'observed',
          `Container declares ${ports.length > 1 ? 'ports' : 'port'} ${ports.join(', ')}. Public exposure is unknown.`,
          number
        )
      }
      if (/^\s*(CMD|ENTRYPOINT)\s/i.test(line)) {
        add(
          'start',
          'observed',
          'Container startup instruction is declared; inspect its source.',
          number
        )
      }
      if (/^\s*FROM\s+\S/i.test(line)) {
        add('image', 'observed', 'Container base image is declared; inspect its source.', number)
      }
    }
    if (yaml && /^\s*-?\s*(readinessProbe|livenessProbe|startupProbe):/.test(line)) {
      add(
        'probe',
        'observed',
        'Kubernetes health probe is declared; effectiveness is unverified.',
        number
      )
    }
    const patterns = [
      /\$\{([A-Z][A-Z0-9_]*)/g,
      /\b(?:secretKeyRef|secretRef|secretName)\s*:/g,
      /\bprocess\.env\.([A-Z][A-Z0-9_]*)/g
    ]
    for (const pattern of patterns) {
      for (const match of line.matchAll(pattern)) {
        const name = match[1]
        if (name && SHELL_VARIABLES.has(name)) {
          continue
        }
        add(
          `configuration:${name ?? 'secret-reference'}`,
          'observed',
          name
            ? `Configuration reference: ${name}`
            : 'Secret reference declared; value and binding were not read.',
          number
        )
        if (name && /DATABASE|POSTGRES|REDIS|MYSQL|MONGO|AMQP|KAFKA/.test(name)) {
          add(
            `dependency:${name}`,
            'inferred',
            `Dependency suggested by ${name}; confirm its purpose and target.`,
            number
          )
        }
      }
    }
  })
  if (/(^|\/)package\.json$/.test(path)) {
    try {
      const pkg: unknown = JSON.parse(text)
      if (
        pkg &&
        typeof pkg === 'object' &&
        'scripts' in pkg &&
        pkg.scripts &&
        typeof pkg.scripts === 'object' &&
        'start' in pkg.scripts
      ) {
        const line = lines.findIndex((value) => /"start"\s*:/.test(value))
        add(
          'npm-start',
          'observed',
          'Package declares a start script; inspect it before execution.',
          line !== -1 ? line + 1 : 1
        )
      }
    } catch {
      /* Invalid source remains available as evidence, not a parsed fact. */
    }
  }
  return facts.slice(0, 100)
}

export function discoveryFingerprint(versions: readonly [string, string][]): string {
  return getDiskBaselineSignature(
    JSON.stringify([...versions].sort(([a], [b]) => a.localeCompare(b)))
  )
}
