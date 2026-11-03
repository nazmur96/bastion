import { kubectlIn } from './devops-kubectl'
import {
  contextTone,
  envWorkloads,
  type EnvColumn,
  type EnvironmentsResult
} from '../../../shared/fork-devops-environments'

const MAX_CONTEXTS = 8

/** Every context in the repo's kubeconfig, read-only, each with the app namespace's workloads. */
export async function readEnvironments(
  workspacePath: string,
  namespace: string
): Promise<EnvironmentsResult> {
  const [contexts, current] = await Promise.all([
    kubectlIn(workspacePath, ['config', 'get-contexts', '-o', 'name']),
    kubectlIn(workspacePath, ['config', 'current-context'])
  ])
  if (!contexts.ok) {
    return { ok: false, error: contexts.out }
  }
  const names = contexts.out
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, MAX_CONTEXTS)
  const columns = await Promise.all(
    names.map(async (context): Promise<EnvColumn> => {
      const result = await kubectlIn(
        workspacePath,
        [
          '--context',
          context,
          '-n',
          namespace,
          'get',
          'deployments,statefulsets',
          '-o',
          'json',
          '--request-timeout=5s'
        ],
        10_000
      )
      return result.ok
        ? { context, tone: contextTone(context), workloads: envWorkloads(result.out) }
        : { context, tone: contextTone(context), workloads: null, error: result.out.slice(0, 160) }
    })
  )
  return { ok: true, current: current.ok ? current.out.trim() || null : null, columns }
}
