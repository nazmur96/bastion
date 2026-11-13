import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { link, lstat, open, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { changePathSchema } from '../../../shared/fork-changes/change-contract'
import { isRootSourceFilename } from '../../../shared/fork-changes/owner-run-contract'

export async function readOwnerSource(root: string, relativePath: string): Promise<string> {
  changePathSchema.parse(relativePath)
  let path = root
  const parts = relativePath.split('/')
  for (const [index, part] of parts.entries()) {
    path = join(path, part)
    const entry = await lstat(path)
    if (
      entry.isSymbolicLink() ||
      (index < parts.length - 1 ? !entry.isDirectory() : !entry.isFile())
    ) {
      throw new Error('Source must be a regular file without symlinked components.')
    }
  }
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    const before = await file.stat()
    if (!before.isFile() || before.size > 65536) {
      throw new Error('Source exceeds inspection bounds.')
    }
    const bytes = Buffer.alloc(before.size)
    const { bytesRead } = await file.read(bytes, 0, bytes.length, 0)
    const after = await file.stat()
    if (
      bytesRead !== before.size ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs ||
      before.ctimeMs !== after.ctimeMs
    ) {
      throw new Error('Source changed during read.')
    }
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } finally {
    await file.close()
  }
}

export async function createOwnerSource(
  root: string,
  name: string,
  content: string
): Promise<'created' | 'conflict'> {
  if (
    !isRootSourceFilename(name) ||
    Buffer.byteLength(content) > 65536 ||
    new TextDecoder().decode(new TextEncoder().encode(content)) !== content
  ) {
    throw new Error('Proposal is outside the supported source-file bounds.')
  }
  if (name.endsWith('.json')) {
    try {
      JSON.parse(content)
    } catch {
      throw new Error('Proposal JSON is invalid.')
    }
  }
  const temporary = join(root, `.bastion-proposal-${randomUUID()}.tmp`)
  // The published file is a hard link to this inode, so it takes this mode: honour the umask like
  // any editor-created source file instead of leaving it readable by its owner only.
  const file = await open(temporary, 'wx', 0o666)
  try {
    await file.writeFile(content, 'utf8')
    await file.sync()
    await file.close()
    try {
      await link(temporary, join(root, name))
      return 'created'
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST') {
        return 'conflict'
      }
      throw error
    }
  } finally {
    await file.close().catch(() => {})
    await unlink(temporary).catch(() => {})
  }
}
