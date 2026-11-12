import { joinPath } from '@/lib/path'
import { listRuntimeFiles } from '@/runtime/runtime-file-search-client'
import { readRuntimeFileRange } from '@/runtime/runtime-file-range-client'
import { captureProjectFileRoute } from '../environments/workspace-environment-files'
import {
  detectDevopsStacks,
  devopsHeadWanted,
  type DevopsStackFinding
} from '../../../../shared/fork-devops-stacks'

// Same bounds as the local inspector, so both owners see the same stacks for the same tree.
const FILE_LIMIT = 20_000
const HEAD_LIMIT = 400
const HEAD_BYTES = 4096
const HEAD_CONCURRENCY = 8
const MISE_FILES = new Set(['mise.toml', '.mise.toml', '.tool-versions'])

export type RuntimeDevopsStacks = { findings: DevopsStackFinding[]; usesMise: boolean }

/** Stacks of a project, read only through its owning runtime; tools and cloud context are not probed. */
export async function readRuntimeDevopsStacks(worktreeId: string): Promise<RuntimeDevopsStacks> {
  const { root, guard, context } = captureProjectFileRoute(worktreeId)
  if (context.target.kind !== 'environment' && context.connectionId) {
    throw new Error('Stack detection is not available for this connection type.')
  }
  const files = await listRuntimeFiles(context, {
    rootPath: root,
    includeIgnored: false,
    allowLegacyIncludeIgnored: true,
    maxResults: FILE_LIMIT
  })
  guard.assertCurrent()
  const wanted = files.filter(devopsHeadWanted).slice(0, HEAD_LIMIT)
  const heads = new Map<string, string>()
  const decoder = new TextDecoder()
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < wanted.length) {
      const relativePath = wanted[next++]
      try {
        const bytes = await readRuntimeFileRange(
          { ...guard.route, filePath: joinPath(root, relativePath), relativePath, worktreeId },
          0,
          HEAD_BYTES
        )
        heads.set(relativePath, decoder.decode(bytes))
      } catch {
        // Empty or unreadable files simply contribute no head.
      }
    }
  }
  await Promise.all(Array.from({ length: HEAD_CONCURRENCY }, worker))
  guard.assertCurrent()
  return {
    findings: detectDevopsStacks(files, (path) => heads.get(path) ?? null),
    usesMise: files.some((path) => MISE_FILES.has(path))
  }
}
