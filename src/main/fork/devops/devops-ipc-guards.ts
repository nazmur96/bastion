import { statSync } from 'node:fs'
import { isAbsolute } from 'node:path'

/** Only real local folders reach the DevOps handlers; SSH and missing paths are refused. */
export function isLocalDirectory(path: unknown): path is string {
  if (typeof path !== 'string' || !isAbsolute(path)) {
    return false
  }
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}
