/**
 * Fork: what a kubectl read actually reached. A failed read is unknown, never "nothing found",
 * and every result names the context and kubeconfig it came from.
 */
export type KubectlCode =
  | 'ok'
  | 'tool-missing'
  | 'denied'
  | 'unreachable'
  | 'no-context'
  | 'timeout'
  | 'failed'
export type KubeconfigSource = 'project' | 'inherited' | 'default'
export type ClusterEvidence = {
  status: KubectlCode
  context: string | null
  kubeconfig: KubeconfigSource
  runner: 'mise' | 'path' | null
}

export const KUBECTL_MESSAGES: Record<Exclude<KubectlCode, 'ok'>, string> = {
  'tool-missing': 'kubectl is not available for this project',
  denied: 'access denied',
  unreachable: 'the cluster did not answer',
  'no-context': 'no kubeconfig context is selected',
  timeout: 'the read timed out',
  failed: 'the read failed'
}

export function classifyKubectlFailure(stderr: string, timedOut: boolean): KubectlCode {
  if (timedOut) {
    return 'timeout'
  }
  if (/\(Forbidden\)|is forbidden|\(Unauthorized\)|must be logged in/i.test(stderr)) {
    return 'denied'
  }
  if (
    /unable to connect to the server|connection to the server .* was refused|no such host/i.test(
      stderr
    )
  ) {
    return 'unreachable'
  }
  if (/current-context is not set|context ".*" does not exist|no context/i.test(stderr)) {
    return 'no-context'
  }
  return 'failed'
}

/** Where KUBECONFIG comes from: the project's own environment, the app's, or kubectl's default. */
export function kubeconfigSource(
  projectEnv: Record<string, string | undefined>,
  inheritedEnv: Record<string, string | undefined>
): KubeconfigSource {
  return projectEnv.KUBECONFIG ? 'project' : inheritedEnv.KUBECONFIG ? 'inherited' : 'default'
}

const SOURCE_LABELS: Record<KubeconfigSource, string> = {
  project: 'project kubeconfig',
  inherited: 'inherited KUBECONFIG',
  default: 'your default kubeconfig'
}

export function clusterEvidenceLine(evidence: ClusterEvidence): string {
  const parts = [
    evidence.status === 'ok'
      ? 'Cluster warnings read'
      : `Cluster warnings unknown: ${KUBECTL_MESSAGES[evidence.status]}`,
    evidence.context ? `context ${evidence.context}` : null,
    SOURCE_LABELS[evidence.kubeconfig],
    evidence.runner === 'mise'
      ? 'project kubectl'
      : evidence.runner === 'path'
        ? 'host kubectl'
        : null
  ]
  return parts.filter(Boolean).join(' · ')
}
