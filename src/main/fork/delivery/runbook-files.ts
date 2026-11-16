import { constants } from 'node:fs'
import { lstat, mkdir, open, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { RunbookSummary } from '../../../shared/fork-delivery/operations-contract'

/**
 * Runbooks are ordinary Markdown in the repository's `runbooks/` directory, so they stay
 * readable in Git hosting or any editor when the affected platform, or Bastion, is down.
 */
export const RUNBOOK_DIRECTORY = 'runbooks'
const MAX_RUNBOOKS = 100

export class RunbookError extends Error {
  constructor(readonly code: 'exists' | 'unsafe-path') {
    super(code)
  }
}

async function directory(root: string, create: boolean): Promise<string | null> {
  const path = join(root, RUNBOOK_DIRECTORY)
  try {
    const entry = await lstat(path)
    if (entry.isSymbolicLink() || !entry.isDirectory()) {
      throw new RunbookError('unsafe-path')
    }
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) {
      throw error
    }
    if (!create) {
      return null
    }
    await mkdir(path)
  }
  return path
}

export async function listRunbooks(root: string): Promise<RunbookSummary[]> {
  const path = await directory(root, false)
  if (!path) {
    return []
  }
  const names = (await readdir(path))
    .filter((name) => /^[a-z0-9][a-z0-9-]{0,80}\.md$/.test(name))
    .sort()
    .slice(0, MAX_RUNBOOKS)
  const runbooks: RunbookSummary[] = []
  for (const name of names) {
    const relative = `${RUNBOOK_DIRECTORY}/${name}`
    try {
      const file = await open(join(path, name), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
      let text = ''
      try {
        if (!(await file.stat()).isFile()) {
          continue
        }
        const head = Buffer.alloc(4096)
        const { bytesRead } = await file.read(head, 0, head.length, 0)
        text = head.subarray(0, bytesRead).toString('utf8')
      } finally {
        await file.close()
      }
      const title = /^#\s+(.+)$/m.exec(text)?.[1]?.trim() ?? name
      runbooks.push({ path: relative, title: title.slice(0, 200) })
    } catch {
      // A symlinked runbook is not listed.
    }
  }
  return runbooks
}

/** Creates a new runbook; never overwrites an existing one. */
export async function createRunbook(root: string, name: string, content: string): Promise<string> {
  const path = await directory(root, true)
  const relative = `${RUNBOOK_DIRECTORY}/${name}.md`
  let handle
  try {
    handle = await open(
      join(path ?? '', `${name}.md`),
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0),
      0o644
    )
  } catch (error) {
    throw error instanceof Error && 'code' in error && error.code === 'EEXIST'
      ? new RunbookError('exists')
      : error
  }
  try {
    await handle.writeFile(content.endsWith('\n') ? content : `${content}\n`, 'utf8')
  } finally {
    await handle.close()
  }
  return relative
}
