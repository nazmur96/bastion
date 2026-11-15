import { kubectlCurrentContext, kubectlIn } from './devops-kubectl'
import { workloadMetrics, type MetricsResult } from '../../../shared/fork-devops-metrics'
import { KUBECTL_MESSAGES } from '../../../shared/fork-devops-kube-evidence'

/**
 * Pods and metrics-server usage, read-only, through the repo's own kubectl and kubeconfig.
 * Both calls use the same context, read once; a failure names its cause and the context.
 */
export async function readWorkloadMetrics(workspacePath: string): Promise<MetricsResult> {
  const pinned = await kubectlCurrentContext(workspacePath)
  if (!pinned.context) {
    const status = pinned.evidence.status === 'ok' ? 'no-context' : pinned.evidence.status
    return { ok: false, error: `Workload metrics unknown: ${KUBECTL_MESSAGES[status]}.` }
  }
  const context = ['--context', pinned.context]
  const [pods, usage] = await Promise.all([
    kubectlIn(
      workspacePath,
      [...context, 'get', 'pods', '--all-namespaces', '-o', 'json', '--request-timeout=10s'],
      20_000
    ),
    kubectlIn(
      workspacePath,
      [...context, 'get', '--raw', '/apis/metrics.k8s.io/v1beta1/pods', '--request-timeout=10s'],
      20_000
    )
  ])
  if (!pods.ok) {
    const cause = pods.code === 'ok' ? 'failed' : pods.code
    return {
      ok: false,
      error: `Workload metrics unknown: ${KUBECTL_MESSAGES[cause]} (context ${pinned.context}).`
    }
  }
  return {
    ok: true,
    byWorkload: workloadMetrics(pods.out, usage.ok ? usage.out : '{}'),
    usage: usage.ok
  }
}
