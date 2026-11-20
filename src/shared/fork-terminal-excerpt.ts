/**
 * Fork: the engineer's selected terminal output, made safe to hand to an agent as an unsent
 * draft. Secrets are redacted, colour codes removed and only the last lines that fit are kept.
 */
export type TerminalExcerpt = { text: string; redactions: number; omittedLines: number }

const REDACTED = '[redacted]'
// eslint-disable-next-line no-control-regex -- terminal escape sequences start with ESC by definition
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g
const PATTERNS: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g,
  /\beyJ[\w-]+\.[\w-]+\.[\w-]+/g,
  /\b(?:ghp|gho|ghu|ghs|github_pat|glpat|xox[abprs])[-_][\w-]{10,}/g,
  /\bBearer\s+[\w.~+/-]+=*/gi,
  /\bAuthorization\s*:\s*Basic\s+[A-Za-z0-9+/]+=*/gi,
  /\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:[^\s/@]+@/gi
]
// key=value or key: value where the key names a secret; the value is replaced, the key kept.
const ASSIGNMENT =
  /\b([\w.-]*(?:secret|password|passwd|token|api[_-]?key|access[_-]?key|private[_-]?key|credential)[\w.-]*)(["']?\s*[=:]\s*)("[^"]*"|'[^']*'|\S+)/gi

export function redactTerminalOutput(selection: string): { text: string; redactions: number } {
  let redactions = 0
  let text = selection.replace(ANSI, '').replace(/\r/g, '')
  for (const pattern of PATTERNS) {
    text = text.replace(pattern, () => {
      redactions += 1
      return REDACTED
    })
  }
  text = text.replace(ASSIGNMENT, (_match, key: string, separator: string, value: string) => {
    if (value === REDACTED) {
      return `${key}${separator}${value}`
    }
    redactions += 1
    return `${key}${separator}${REDACTED}`
  })
  return { text, redactions }
}

export function terminalExcerpt(selection: string, limit = 1800): TerminalExcerpt {
  const { text, redactions } = redactTerminalOutput(selection)
  const lines = text.split('\n').map((line) => line.trimEnd())
  while (lines.length && !lines[0].trim()) {
    lines.shift()
  }
  while (lines.length && !lines.at(-1)?.trim()) {
    lines.pop()
  }
  // Keep the end: a failure's cause is usually in its last lines.
  const kept: string[] = []
  let size = 0
  for (let index = lines.length - 1; index >= 0; index--) {
    const next = lines[index].length + (kept.length ? 1 : 0)
    if (size + next > limit) {
      break
    }
    kept.unshift(lines[index])
    size += next
  }
  return { text: kept.join('\n'), redactions, omittedLines: lines.length - kept.length }
}

export function terminalAgentDraft(excerpt: TerminalExcerpt): string {
  const notes = [
    excerpt.omittedLines ? `${excerpt.omittedLines} earlier line(s) omitted` : null,
    excerpt.redactions ? `${excerpt.redactions} value(s) redacted` : null
  ].filter(Boolean)
  return [
    'This output is from my terminal. Explain the most likely cause and propose a fix.',
    'Do not run commands or change files yet; tell me what you would do first.',
    notes.length ? `(${notes.join('; ')}.)` : null,
    '```text',
    excerpt.text,
    '```'
  ]
    .filter((line) => line !== null)
    .join('\n')
}
