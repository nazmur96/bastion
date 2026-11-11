import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { daemonRuntimeDirFor } from '../../daemon/daemon-runtime-dir'
import { parseDaemonPidFile } from '../../daemon/daemon-pid-file-parse'

export function incognitoProcessAlive(pid: unknown): boolean {
  if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) {
    return false
  }
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return !error || typeof error !== 'object' || !('code' in error) || error.code !== 'ESRCH'
  }
}

/** Refuse data removal if any daemon generation can still own task processes. */
export function stoppedIncognitoDaemonDirectory(root: string): string {
  const directory = daemonRuntimeDirFor(root)
  if (!existsSync(directory)) {
    return directory
  }
  for (const file of readdirSync(directory)) {
    if (!file.startsWith('daemon-v') || !file.endsWith('.pid')) {
      continue
    }
    const record = parseDaemonPidFile(readFileSync(join(directory, file), 'utf8'))
    if (
      !record ||
      !Number.isInteger(record.pid) ||
      record.pid <= 0 ||
      incognitoProcessAlive(record.pid)
    ) {
      throw new Error(
        'This task still has a terminal runtime. Reopen it and use Archive and leave, then retry deletion.'
      )
    }
  }
  return directory
}
