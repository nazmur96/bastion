import type { MapHealth, MapNode } from '../../../../shared/fork-devops-system-map'
import {
  costLabel,
  metricsLabel,
  requestedMonthlyCost,
  type MetricsResult,
  type WorkloadMetrics
} from '../../../../shared/fork-devops-metrics'

export type MapLens = 'health' | 'blast' | 'security' | 'metrics' | 'cost'

/** The status dot a node shows under each lens. */
export function lensDot(
  lens: MapLens,
  item: MapNode,
  live: WorkloadMetrics | undefined
): MapHealth {
  if (lens === 'cost' && live) {
    return requestedMonthlyCost(live) === null ? 'warn' : 'ok'
  }
  if (lens === 'metrics' && live) {
    return live.restarts > 5 ? 'bad' : live.restarts > 0 ? 'warn' : 'ok'
  }
  if (lens === 'security') {
    return item.risks.length === 0 ? 'ok' : item.risks.length > 2 ? 'bad' : 'warn'
  }
  return item.health
}

/** The small first line a node shows under each lens. */
export function lensCaption(
  lens: MapLens,
  item: MapNode,
  live: WorkloadMetrics | undefined,
  metrics: MetricsResult | null
): string {
  if (lens === 'cost' && live) {
    return costLabel(live)
  }
  if (lens === 'metrics' && live && metrics?.ok) {
    return metricsLabel(live, metrics.usage)
  }
  return `${item.kind} · ${item.namespace}`
}
