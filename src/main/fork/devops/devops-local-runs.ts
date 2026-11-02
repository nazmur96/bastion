import { existsSync } from 'node:fs'
import { request } from 'node:https'
import { join } from 'node:path'
import { MISE_FILES, resolveTool, run } from './devops-inspect'
import { devopsCommandLine, type DevopsToolStatus } from '../../../shared/fork-devops-inspection'
import {
  localApiServer,
  parseK3dClusters,
  parseKindClusters,
  parseMultipassList,
  type LocalRun
} from '../../../shared/fork-devops-local-runs'

const PROBE_MS = 3_000

const LISTERS: readonly {
  tool: string
  args: string[]
  parse: (stdout: string) => LocalRun[]
  /** How to get one cluster's kubeconfig, for the API probe. */
  kubeconfig?: (name: string) => string[]
}[] = [
  {
    tool: 'kind',
    args: ['get', 'clusters'],
    parse: parseKindClusters,
    kubeconfig: (name) => ['get', 'kubeconfig', '--name', name]
  },
  {
    tool: 'k3d',
    args: ['cluster', 'list', '-o', 'json'],
    parse: parseK3dClusters,
    kubeconfig: (name) => ['kubeconfig', 'get', name]
  },
  { tool: 'multipass', args: ['list', '--format', 'json'], parse: parseMultipassList }
]

function runTool(status: DevopsToolStatus, tool: string, args: string[], cwd: string) {
  return status.available && status.runner === 'mise'
    ? run('mise', ['exec', '--', tool, ...args], cwd, 15_000)
    : run(tool, args, cwd, 15_000)
}

/**
 * Any HTTP answer means the API server is up (anonymous /readyz may be 401/403);
 * a refused, reset or silent connection means it is not. Local addresses only; the
 * cluster's self-signed certificate is expected, and nothing is sent but the GET.
 */
function probeApi(server: string): Promise<'ready' | 'down'> {
  return new Promise((resolve) => {
    const req = request(
      `${server}/readyz`,
      { method: 'GET', rejectUnauthorized: false, timeout: PROBE_MS },
      (res) => {
        res.resume()
        resolve('ready')
      }
    )
    req.on('timeout', () => req.destroy())
    req.on('error', () => resolve('down'))
    req.end()
  })
}

/** Machine-wide, not per repo: a cluster started from another workspace still costs this laptop. */
export async function listLocalRuns(workspacePath: string): Promise<LocalRun[]> {
  const usesMise = MISE_FILES.some((name) => existsSync(join(workspacePath, name)))
  const shell = process.platform === 'win32' ? 'windows' : 'posix'
  const found = await Promise.all(
    LISTERS.map(async ({ tool, args, parse, kubeconfig }) => {
      const status = await resolveTool(workspacePath, tool, usesMise)
      if (!status.available) {
        return []
      }
      const result = await runTool(status, tool, args, workspacePath)
      if (!result.ok) {
        return []
      }
      return Promise.all(
        parse(result.stdout).map(async (item): Promise<LocalRun> => {
          const remove = devopsCommandLine(status, item.remove, shell)
          if (!kubeconfig) {
            return { ...item, remove }
          }
          const config = await runTool(status, tool, kubeconfig(item.name), workspacePath)
          const server = config.ok ? localApiServer(config.stdout) : null
          return server ? { ...item, remove, api: await probeApi(server) } : { ...item, remove }
        })
      )
    })
  )
  return found.flat()
}
