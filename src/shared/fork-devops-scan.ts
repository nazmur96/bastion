/** Fork, path stage Harden: Trivy misconfigurations as findings on files and lines. */
export type ScanSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN'

export type ScanFinding = {
  /** Repo-relative, forward slashes. */
  file: string
  line: number
  endLine: number
  severity: ScanSeverity
  id: string
  title: string
  resolution: string
}

export type ScanResult = { ok: true; findings: ScanFinding[] } | { ok: false; error: string }

const SEVERITIES = new Set<string>(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN'])

function isSeverity(value: unknown): value is ScanSeverity {
  return typeof value === 'string' && SEVERITIES.has(value)
}

function at(value: unknown, ...keys: string[]): unknown {
  let current = value
  for (const key of keys) {
    if (current === null || typeof current !== 'object') {
      return undefined
    }
    current = Reflect.get(current, key)
  }
  return current
}

const ORDER: Record<ScanSeverity, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3, UNKNOWN: 4 }

/** `trivy config --format json` → failed checks with their lines, worst first. */
export function parseTrivyConfig(stdout: string): ScanFinding[] {
  let value: unknown
  try {
    value = JSON.parse(stdout)
  } catch {
    return []
  }
  const results = at(value, 'Results')
  if (!Array.isArray(results)) {
    return []
  }
  const findings: ScanFinding[] = []
  for (const result of results) {
    const target = at(result, 'Target')
    const misconfigurations = at(result, 'Misconfigurations')
    if (typeof target !== 'string' || !Array.isArray(misconfigurations)) {
      continue
    }
    for (const item of misconfigurations) {
      if (at(item, 'Status') === 'PASS') {
        continue
      }
      const severity = at(item, 'Severity')
      const start = at(item, 'CauseMetadata', 'StartLine')
      const end = at(item, 'CauseMetadata', 'EndLine')
      const line = typeof start === 'number' && start > 0 ? start : 1
      findings.push({
        file: target.replaceAll('\\', '/'),
        line,
        endLine: typeof end === 'number' && end >= line ? end : line,
        severity: isSeverity(severity) ? severity : 'UNKNOWN',
        id: String(at(item, 'AVDID') ?? at(item, 'ID') ?? ''),
        title: String(at(item, 'Title') ?? at(item, 'Message') ?? 'Misconfiguration'),
        resolution: String(at(item, 'Resolution') ?? '')
      })
    }
  }
  return findings.sort(
    (a, b) =>
      ORDER[a.severity] - ORDER[b.severity] || a.file.localeCompare(b.file) || a.line - b.line
  )
}

/** The request Claude gets for one file's findings: fix on the lines, explain, nothing else touched. */
export function fixFindingsPrompt(file: string, findings: readonly ScanFinding[]): string {
  const lines = findings.map(
    (finding) =>
      `- line ${finding.line}: [${finding.severity}] ${finding.id} ${finding.title}${finding.resolution ? ` (fix: ${finding.resolution})` : ''}`
  )
  return [
    `Fix these Trivy misconfigurations in ${file}, keeping the change minimal and the app working:`,
    ...lines,
    'Edit only that file. Explain each change in one line, and skip any finding that would break the app (say why).'
  ].join('\n')
}
