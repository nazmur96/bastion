import type { DiscoveryFact } from './service-knowledge'

export function isDiscoverySensitivePath(path: string): boolean {
  return /(^|[\\/])\.env[^/\\]*$|\.tfvars(?:\.json)?$|\.enc\.[^/]+$|secret|credential|kubeconfig|htpasswd/i.test(
    path
  )
}

export function discoverySourceWanted(path: string): boolean {
  if (/(^|\/)(node_modules|vendor|dist|build|\.git|\.terraform|\.venv)\//.test(path)) {
    return false
  }
  // Anywhere in the path: Kubernetes Secret manifests and kubeconfigs are rarely named secret.yaml.
  if (isDiscoverySensitivePath(path)) {
    return false
  }
  return /(^|\/)(Dockerfile(?:\.[^/]+)?|Containerfile|package\.json|pyproject\.toml|go\.mod|Cargo\.toml|Procfile|(?:docker-)?compose[^/]*\.ya?ml|Chart\.yaml|[^/]+\.tf|[^/]+\.ya?ml)$/.test(
    path
  )
}

const DOCKERFILE = /(^|\/)(Dockerfile(\.[^/]+)?|Containerfile)$/
const YAML = /\.ya?ml$/
// Pipelines describe the build, not the service: their variables are not service configuration.
const CI = /(^|\/)(\.github\/workflows\/|\.circleci\/)|(^|\/)(\.gitlab-ci|azure-pipelines)\.ya?ml$/
const EVIDENCE_PER_FACT = 20
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
  const ci = CI.test(path)
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
    for (const pattern of ci ? [] : patterns) {
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

/** One card per statement: repeated declarations become extra evidence on the first. */
export function groupDiscoveryFacts(facts: readonly DiscoveryFact[]): DiscoveryFact[] {
  const grouped = new Map<string, DiscoveryFact>()
  for (const fact of facts) {
    const key = `${fact.kind}\0${fact.summary}`
    const existing = grouped.get(key)
    if (!existing) {
      grouped.set(key, { ...fact, evidence: fact.evidence.slice(0, EVIDENCE_PER_FACT) })
      continue
    }
    for (const evidence of fact.evidence) {
      if (existing.evidence.length < EVIDENCE_PER_FACT) {
        existing.evidence.push(evidence)
      } else {
        existing.omitted = (existing.omitted ?? 0) + 1
      }
    }
  }
  return [...grouped.values()]
}
