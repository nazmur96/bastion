import { createHash } from 'node:crypto'
import { chmodSync, lstatSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

/** Unix endpoints have a ~104-byte limit; deep workspace roots need a private short socket home. */
export function boundedSocketDirectory(directory: string, platform = process.platform): string {
  if (platform === 'win32' || Buffer.byteLength(directory) <= 70) {
    return directory
  }
  const hash = createHash('sha256').update(resolve(directory)).digest('hex').slice(0, 20)
  const path = join(tmpdir(), `bastion-${hash}`)
  if (Buffer.byteLength(path) > 70) {
    throw new Error('Temporary directory is too long for workspace sockets.')
  }
  mkdirSync(path, { recursive: true, mode: 0o700 })
  const stat = lstatSync(path)
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    (process.getuid && stat.uid !== process.getuid())
  ) {
    throw new Error('Workspace socket directory is not privately owned.')
  }
  chmodSync(path, 0o700)
  return path
}
