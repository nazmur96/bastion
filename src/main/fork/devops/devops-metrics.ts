import { kubectlIn } from './devops-kubectl'
import { workloadMetrics, type MetricsResult } from '../../../shared/fork-devops-metrics'

/** Pods and metrics-server usage, read-only, through the repo's own kubectl and kubeconfig. */
export async function readWorkloadMetrics(workspacePath: string): Promise<MetricsResult> {
  const [pods, usage] = await Promise.all([
    kubectlIn(
      workspacePath,
      ['get', 'pods', '--all-namespaces', '-o', 'json', '--request-timeout=10s'],
      20_000
    ),
    kubectlIn(
      workspacePath,
      ['get', '--raw', '/apis/metrics.k8s.io/v1beta1/pods', '--request-timeout=10s'],
      20_000
    )
  ])
  if (!pods.ok) {
    return { ok: false, error: pods.out }
  }
  return {
    ok: true,
    byWorkload: workloadMetrics(pods.out, usage.ok ? usage.out : '{}'),
    usage: usage.ok
  }
}
