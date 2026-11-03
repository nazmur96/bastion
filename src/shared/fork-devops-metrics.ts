import { mapNodeId } from './fork-devops-system-map'

/** Fork, observability: live usage per workload, for the map's Metrics lens. */
export type WorkloadMetrics = {
  /** Total over the workload's pods, in millicores. */
  cpuMilli: number
  memoryMi: number
  restarts: number
  pods: number
  /** Sum of the pods' container requests; 0 when none are set. */
  cpuRequestMilli: number
  memoryRequestMi: number
}

export type MetricsResult =
  | {
      ok: true
      byWorkload: Record<string, WorkloadMetrics>
      /** metrics-server answered; without it only restarts are known. */
      usage: boolean
    }
  | { ok: false; error: string }

function at(value: unknown, ...keys: string[]): unknown {
  let current = value
  for (const key of keys) {
    if (current === null || typeof current !== 'object') {
      return undefined
    }
    current = Reflect.get(current, key)
  }
  return current
}

function items(json: string): unknown[] {
  try {
    const value = at(JSON.parse(json), 'items')
    return Array.isArray(value) ? value : []
  } catch {
    return []
  }
}

/** `250m` → 250, `1` → 1000, `1500000n` → 1.5 (nanocores). */
export function cpuMilli(quantity: string): number {
  if (quantity.endsWith('n')) {
    return Number(quantity.slice(0, -1)) / 1e6
  }
  if (quantity.endsWith('u')) {
    return Number(quantity.slice(0, -1)) / 1e3
  }
  if (quantity.endsWith('m')) {
    return Number(quantity.slice(0, -1))
  }
  return Number(quantity) * 1000
}

const MEMORY_UNITS: Record<string, number> = {
  Ki: 1 / 1024,
  Mi: 1,
  Gi: 1024,
  K: 1000 / 1048576,
  M: 1e6 / 1048576,
  G: 1e9 / 1048576
}

/** `64Mi` → 64, `131072Ki` → 128, plain bytes → MiB. */
export function memoryMi(quantity: string): number {
  const match = /^([\d.]+)([KMG]i?)?$/.exec(quantity)
  if (!match) {
    return 0
  }
  const unit = match[2]
  return unit ? Number(match[1]) * (MEMORY_UNITS[unit] ?? 0) : Number(match[1]) / 1048576
}

/** The workload a pod belongs to: Deployment through its ReplicaSet's hash, or its direct owner. */
function workloadOf(pod: unknown): string | null {
  const namespace = at(pod, 'metadata', 'namespace')
  const owners = at(pod, 'metadata', 'ownerReferences')
  if (typeof namespace !== 'string' || !Array.isArray(owners) || owners.length === 0) {
    return null
  }
  const kind = at(owners[0], 'kind')
  const name = at(owners[0], 'name')
  if (typeof kind !== 'string' || typeof name !== 'string') {
    return null
  }
  if (kind === 'ReplicaSet') {
    // <deployment>-<pod-template-hash>
    return mapNodeId('Deployment', namespace, name.replace(/-[a-z0-9]{6,10}$/, ''))
  }
  return kind === 'StatefulSet' || kind === 'DaemonSet' ? mapNodeId(kind, namespace, name) : null
}

/**
 * `kubectl get pods -A -o json` and metrics.k8s.io PodMetricsList → usage per workload node id
 * (the same ids the system map uses). Pods without usage still count restarts.
 */
export function workloadMetrics(
  podsJson: string,
  podMetricsJson: string
): Record<string, WorkloadMetrics> {
  const usage = new Map<string, { cpu: number; memory: number }>()
  for (const entry of items(podMetricsJson)) {
    const key = `${String(at(entry, 'metadata', 'namespace'))}/${String(at(entry, 'metadata', 'name'))}`
    const containers = at(entry, 'containers')
    let cpu = 0
    let memory = 0
    for (const container of Array.isArray(containers) ? containers : []) {
      const c = at(container, 'usage', 'cpu')
      const m = at(container, 'usage', 'memory')
      cpu += typeof c === 'string' ? cpuMilli(c) : 0
      memory += typeof m === 'string' ? memoryMi(m) : 0
    }
    usage.set(key, { cpu, memory })
  }
  const out: Record<string, WorkloadMetrics> = {}
  for (const pod of items(podsJson)) {
    const workload = workloadOf(pod)
    if (!workload) {
      continue
    }
    const key = `${String(at(pod, 'metadata', 'namespace'))}/${String(at(pod, 'metadata', 'name'))}`
    const statuses = at(pod, 'status', 'containerStatuses')
    const restarts = (Array.isArray(statuses) ? statuses : []).reduce(
      (sum: number, status) =>
        sum +
        (typeof at(status, 'restartCount') === 'number' ? Number(at(status, 'restartCount')) : 0),
      0
    )
    const used = usage.get(key)
    const containers = at(pod, 'spec', 'containers')
    let cpuRequest = 0
    let memoryRequest = 0
    for (const container of Array.isArray(containers) ? containers : []) {
      const c = at(container, 'resources', 'requests', 'cpu')
      const m = at(container, 'resources', 'requests', 'memory')
      cpuRequest += typeof c === 'string' ? cpuMilli(c) : 0
      memoryRequest += typeof m === 'string' ? memoryMi(m) : 0
    }
    const current = out[workload] ?? {
      cpuMilli: 0,
      memoryMi: 0,
      restarts: 0,
      pods: 0,
      cpuRequestMilli: 0,
      memoryRequestMi: 0
    }
    out[workload] = {
      cpuMilli: current.cpuMilli + (used?.cpu ?? 0),
      memoryMi: current.memoryMi + (used?.memory ?? 0),
      restarts: current.restarts + restarts,
      pods: current.pods + 1,
      cpuRequestMilli: current.cpuRequestMilli + cpuRequest,
      memoryRequestMi: current.memoryRequestMi + memoryRequest
    }
  }
  return out
}

/** One line for a map node: `12m CPU · 64Mi · ↻2`. */
export function metricsLabel(metrics: WorkloadMetrics, usage: boolean): string {
  const restarts = metrics.restarts > 0 ? ` · ↻${metrics.restarts}` : ''
  return usage
    ? `${Math.round(metrics.cpuMilli)}m CPU · ${Math.round(metrics.memoryMi)}Mi${restarts}`
    : `${metrics.pods} pod${metrics.pods === 1 ? '' : 's'}${restarts}`
}

/** AWS Fargate list prices (us-east-1, Linux/x86): a transparent basis, not a bill. */
export const FARGATE_VCPU_HOUR = 0.04048
export const FARGATE_GB_HOUR = 0.004445
const HOURS_PER_MONTH = 730

/** Monthly cost of what the workload requests, at Fargate prices; null when nothing is requested. */
export function requestedMonthlyCost(metrics: WorkloadMetrics): number | null {
  if (metrics.cpuRequestMilli === 0 && metrics.memoryRequestMi === 0) {
    return null
  }
  const vcpu = metrics.cpuRequestMilli / 1000
  const gb = metrics.memoryRequestMi / 1024
  return (vcpu * FARGATE_VCPU_HOUR + gb * FARGATE_GB_HOUR) * HOURS_PER_MONTH
}

export function costLabel(metrics: WorkloadMetrics): string {
  const cost = requestedMonthlyCost(metrics)
  return cost === null
    ? 'no requests set'
    : `≈ $${cost < 1 ? cost.toFixed(2) : cost.toFixed(0)}/mo · ${Math.round(metrics.cpuRequestMilli)}m · ${Math.round(metrics.memoryRequestMi)}Mi`
}
