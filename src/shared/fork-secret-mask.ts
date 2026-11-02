/** Fork A4: where secret values sit in a file, so the editor can hide them and Claude never gets them. */
export type SecretRange = { line: number; startColumn: number; endColumn: number }

export const SECRET_MASK = '••••••'

const SECRET_KEY =
  /(pass(word|wd)?|secret|token|api[_-]?key|private[_-]?key|access[_-]?key|client[_-]?secret|credentials?|auth)$/i

/** Values that are clearly not secrets: empty, placeholders, references and SOPS ciphertext. */
function isPlaceholder(value: string): boolean {
  return (
    value.length < 4 ||
    /^(ENC\[|\$\{|\$\(|\{\{|<|changeme$|xxx+$|true$|false$|null$|~$)/i.test(value) ||
    /^[A-Z_]+$/.test(value)
  )
}

const TOKEN_SHAPES = [
  /AKIA[0-9A-Z]{16}/g,
  /gh[pousr]_[A-Za-z0-9]{30,}/g,
  /github_pat_[A-Za-z0-9_]{40,}/g,
  /xox[abpr]-[A-Za-z0-9-]{10,}/g,
  /sk-ant-[A-Za-z0-9_-]{20,}/g,
  /sk-[A-Za-z0-9]{32,}/g
]

/** `KEY=value`, `KEY: value`, `"key": "value"`, `key = "value"` (tfvars). */
const ASSIGNMENT =
  /^(\s*(?:export\s+)?["']?([A-Za-z0-9_.-]+)["']?\s*[:=]\s*)(["']?)([^"'\s#,][^"'#]*?)\3\s*,?\s*(?:#.*)?$/

export function secretRanges(text: string): SecretRange[] {
  const ranges: SecretRange[] = []
  const lines = text.split(/\r?\n/)
  let inSecretDoc = false
  let dataIndent = -1
  let inPem = false
  lines.forEach((line, index) => {
    const lineNumber = index + 1
    if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(line)) {
      inPem = true
    }
    if (inPem) {
      if (line.length > 0) {
        ranges.push({ line: lineNumber, startColumn: 1, endColumn: line.length + 1 })
      }
      if (/-----END [A-Z ]*PRIVATE KEY-----/.test(line)) {
        inPem = false
      }
      return
    }
    if (/^---\s*$/.test(line)) {
      inSecretDoc = false
      dataIndent = -1
    }
    if (/^kind:\s*Secret\s*$/.test(line)) {
      inSecretDoc = true
    }
    const indent = line.length - line.trimStart().length
    if (dataIndent >= 0 && line.trim() && indent <= dataIndent) {
      dataIndent = -1
    }
    if (inSecretDoc && /^(\s*)(data|stringData):\s*$/.test(line)) {
      dataIndent = indent
      return
    }
    const match = ASSIGNMENT.exec(line)
    if (match) {
      const [, prefix, key, quote, value] = match
      const underSecretData = dataIndent >= 0 && indent > dataIndent
      if ((underSecretData || SECRET_KEY.test(key)) && !isPlaceholder(value)) {
        const start = prefix.length + quote.length + 1
        ranges.push({ line: lineNumber, startColumn: start, endColumn: start + value.length })
        return
      }
    }
    for (const shape of TOKEN_SHAPES) {
      for (const found of line.matchAll(shape)) {
        const start = (found.index ?? 0) + 1
        ranges.push({ line: lineNumber, startColumn: start, endColumn: start + found[0].length })
      }
    }
  })
  return ranges
}

/** The text with every secret value replaced, for anything that leaves the editor. */
export function maskSecrets(text: string): string {
  const ranges = secretRanges(text)
  if (ranges.length === 0) {
    return text
  }
  const lines = text.split(/(\r?\n)/)
  // split with a capture group interleaves separators: line i sits at index 2*(i-1).
  for (const range of [...ranges].sort((a, b) => b.startColumn - a.startColumn)) {
    const at = (range.line - 1) * 2
    const line = lines[at]
    lines[at] = line.slice(0, range.startColumn - 1) + SECRET_MASK + line.slice(range.endColumn - 1)
  }
  return lines.join('')
}

/** SOPS-encrypted files carry their own metadata block and ENC[…] values. */
export function isSopsEncrypted(text: string): boolean {
  return /ENC\[AES256_GCM,/.test(text) && /(^|\n)sops:\s*$|"sops"\s*:/m.test(text)
}
