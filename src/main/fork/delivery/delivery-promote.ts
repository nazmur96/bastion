import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, open, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { fileFingerprint, pinnedDigest, withPinnedDigest } from './kustomize-digest'

export class PromoteError extends Error {
  constructor(readonly code: 'changed' | 'unsafe-path' | 'invalid') {
    super(code)
  }
}

/**
 * Pins one image digest in the deployment config. Refuses symlinked components and a file
 * that changed since the engineer reviewed it; replaces it atomically, keeping its mode.
 * Committing and pushing stay with the engineer, so the controller's Git source decides.
 */
export async function promoteDigest(request: {
  root: string
  configPath: string
  imageName: string
  digest: string
  reviewedFingerprint: string
}): Promise<{ from: string | null; to: string }> {
  let path = request.root
  const parts = request.configPath.split('/')
  for (const [index, part] of parts.entries()) {
    path = join(path, part)
    const entry = await lstat(path)
    if (
      entry.isSymbolicLink() ||
      (index < parts.length - 1 ? !entry.isDirectory() : !entry.isFile())
    ) {
      throw new PromoteError('unsafe-path')
    }
  }
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  let text: string
  let mode: number
  try {
    const stat = await handle.stat()
    if (stat.size > 65536) {
      throw new PromoteError('invalid')
    }
    mode = stat.mode & 0o777
    text = await handle.readFile('utf8')
  } finally {
    await handle.close()
  }
  if (fileFingerprint(text) !== request.reviewedFingerprint) {
    throw new PromoteError('changed')
  }
  const from = pinnedDigest(text, request.imageName)
  const next = withPinnedDigest(text, request.imageName, request.digest)
  const temporary = `${path}.bastion-${randomUUID()}`
  const output = await open(
    temporary,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
    mode
  )
  try {
    await output.writeFile(next)
    await output.sync()
  } finally {
    await output.close()
  }
  try {
    await rename(temporary, path)
  } catch (error) {
    await rm(temporary, { force: true })
    throw error
  }
  return { from, to: request.digest }
}
