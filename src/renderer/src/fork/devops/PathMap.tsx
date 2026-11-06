import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import { openManifest } from './open-manifest'
import { InfraRunsCard } from './InfraRunsCard'
import type { DevopsContext } from '../../../../shared/fork-devops-context'
import type { MapNode, SystemMapResult } from '../../../../shared/fork-devops-system-map'

/** Services and ingresses span the column; workloads and their config pair up. */
function wide(node: MapNode): boolean {
  return node.layer < 2
}

/** The path column's compact system map, its live run log underneath; the full map opens
 *  as a tab in the middle. */
export function PathMap({
  worktreeId,
  context,
  result,
  onOpenFull
}: {
  worktreeId: string
  context: DevopsContext
  result: SystemMapResult | null
  onOpenFull: () => void
}): React.JSX.Element {
  const kube = context.kube
  const nodes = result?.ok ? result.map.nodes.toSorted((a, b) => a.layer - b.layer) : []
  return (
    <div className="bx-mapbox scrollbar-sleek" data-path-map="">
      <div className="bx-map-head">
        <span className="lbl">{translate('components.devops.pathMap.title', 'System map')}</span>
        {kube ? (
          <button type="button" className="bx-map-open" onClick={onOpenFull}>
            {translate('components.devops.pathMap.openFull', 'Open full map ↗')}
          </button>
        ) : null}
      </div>
      {nodes.length > 0 ? (
        <div className="bx-map-grid">
          {nodes.map((node) => (
            <button
              type="button"
              key={node.id}
              className={cn('bx-node', wide(node) && 'wide', node.health !== 'ok' && node.health)}
              title={`${node.namespace}/${node.name} · ${node.detail}\n${translate('components.devops.pathMap.open', 'Open its manifest')}`}
              onClick={() => void openManifest(worktreeId, node.kind, node.name)}
            >
              <div className="k">{node.kind}</div>
              <div className="n">
                {node.name} {node.detail}
              </div>
              <span className="d" />
            </button>
          ))}
        </div>
      ) : (
        <div className="empty">
          {!kube
            ? translate(
                'components.devops.pathMap.noCluster',
                'No cluster yet. The next step starts one.'
              )
            : result && !result.ok
              ? result.error
              : result
                ? translate('components.devops.pathMap.nothing', 'Nothing is running yet.')
                : translate('components.devops.pathMap.reading', 'Reading the cluster…')}
        </div>
      )}
      <InfraRunsCard />
    </div>
  )
}
