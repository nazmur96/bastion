import { SECRET_MASK, maskSecrets } from '../fork-secret-mask'

export const LOG_LIMITS = { lines: 100, bytes: 16 * 1024 }

const BEARER = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/g
const JWT = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g
const URL_CREDENTIALS = /(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/:@]+:[^\s/@]+@/gi

/** The last lines of a container log, bounded and with secret-looking values masked. */
export function logExcerpt(raw: string): { text: string; truncated: boolean; redactions: number } {
  let truncated = false
  let text = raw
  if (text.length > LOG_LIMITS.bytes) {
    text = text.slice(-LOG_LIMITS.bytes)
    truncated = true
  }
  const lines = text.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n')
  if (lines.length > LOG_LIMITS.lines) {
    truncated = true
  }
  const kept = lines.slice(-LOG_LIMITS.lines).join('\n')
  const before = kept.split(SECRET_MASK).length
  const masked = maskSecrets(kept)
    .replace(BEARER, `$1 ${SECRET_MASK}`)
    .replace(JWT, SECRET_MASK)
    .replace(URL_CREDENTIALS, `$1${SECRET_MASK}@`)
  return { text: masked, truncated, redactions: masked.split(SECRET_MASK).length - before }
}
