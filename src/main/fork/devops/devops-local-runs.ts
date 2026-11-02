import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { MISE_FILES, resolveTool, run } from './devops-inspect'
import { devopsCommandLine } from '../../../shared/fork-devops-inspection'
import {
  parseK3dClusters,
  parseKindClusters,
  parseMultipassList,
  type LocalRun
} from '../../../shared/fork-devops-local-runs'

const LISTERS: readonly {
  tool: string
  args: string[]
  parse: (stdout: string) => LocalRun[]
}[] = [
  { tool: 'kind', args: ['get', 'clusters'], parse: parseKindClusters },
  { tool: 'k3d', args: ['cluster', 'list', '-o', 'json'], parse: parseK3dClusters },
  { tool: 'multipass', args: ['list', '--format', 'json'], parse: parseMultipassList }
]

/** Machine-wide, not per repo: a cluster started from another workspace still costs this laptop. */
export async function listLocalRuns(workspacePath: string): Promise<LocalRun[]> {
  const usesMise = MISE_FILES.some((name) => existsSync(join(workspacePath, name)))
  const shell = process.platform === 'win32' ? 'windows' : 'posix'
  const found = await Promise.all(
    LISTERS.map(async ({ tool, args, parse }) => {
      const status = await resolveTool(workspacePath, tool, usesMise)
      if (!status.available) {
        return []
      }
      const result =
        status.runner === 'mise'
          ? await run('mise', ['exec', '--', tool, ...args], workspacePath, 15_000)
          : await run(tool, args, workspacePath, 15_000)
      return result.ok
        ? parse(result.stdout).map((item) => ({
            ...item,
            remove: devopsCommandLine(status, item.remove, shell)
          }))
        : []
    })
  )
  return found.flat()
}
