import { getDiskBaselineSignature } from '../disk-baseline-signature'
import type { SourceCheckCode } from './change-contract'

export function checkSourceText(path: string, text: string, fingerprint: string): SourceCheckCode {
  if (getDiskBaselineSignature(text) !== fingerprint) {
    return 'changed'
  }
  if (!path.endsWith('.json')) {
    return 'readable'
  }
  try {
    JSON.parse(text)
    return 'json-valid'
  } catch {
    return 'json-invalid'
  }
}
