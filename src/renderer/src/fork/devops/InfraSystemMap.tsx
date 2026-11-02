import { useCallback, useEffect, useMemo, useState } from 'react'
import { FileText, MessageSquare, RefreshCw, ScrollText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store'
import { selectKnownWorktreeById } from '@/store/selectors'
import { translate } from '@/i18n/i18n'
import { runInWorkbenchTerminal } from '../workbench/workbench-terminals'
import { draftForClaude } from './ask-claude'
import { InfraCard } from './InfraHomeCards'
import type { DevopsContext } from '../../../../shared/fork-devops-context'
import {
  upstreamOf,
  type MapHealth,
  type MapNode,
  type SystemMapResult
} from '../../../../shared/fork-devops-system-map'

const REFRESH_MS = 15_000
const NODE_W = 168
const NODE_H = 44
const GAP_X = 14
const LANE_H = 76
const PAD = 12
const LANES = ['traffic in', 'services', 'workloads', 'config'] as const

const HEALTH_CLASS: Record<MapHealth, string> = {
  ok: 'text-status-success',
  warn: 'text-status-warning',
  bad: 'text-destructive'
}

type Lens = 'health' | 'blast' | 'security'

function useSystemMap(
  path: string | undefined,
  contextKey: string
): {
  result: SystemMapResult | null
  refresh: () => void
} {
  const [result, setResult] = useState<SystemMapResult | null>(null)
  const [round, setRound] = useState(0)
  useEffect(() => {
    if (!path) {
      return
    }
    let current = true
    const load = (): void => {
      void window.api.aiVault.readSystemMap(path).then((next) => {
        if (current) {
          setResult(next)
        }
      })
    }
    load()
    const timer = window.setInterval(load, REFRESH_MS)
    return () => {
      current = false
      window.clearInterval(timer)
    }
  }, [path, contextKey, round])
  return { result, refresh: useCallback(() => setRound((value) => value + 1), []) }
}

function kubectlRef(node: MapNode): string {
  return `-n ${node.namespace} ${node.kind.toLowerCase()}/${node.name}`
}

/** The centre of the Infra home: what runs in the cluster, how it connects, what is unhealthy. */
export function InfraSystemMap({
  worktreeId,
  context,
  kubectlPrefix
}: {
  worktreeId: string
  context: DevopsContext
  /** `mise exec -- ` when the repo pins kubectl, so terminals use the same one. */
  kubectlPrefix: string
}): React.JSX.Element | null {
  const path = useAppStore((state) => selectKnownWorktreeById(state, worktreeId)?.path)
  const kube = context.kube
  const { result, refresh } = useSystemMap(path, kube?.context ?? '')
  const [selected, setSelected] = useState<string | null>(null)
  const [lens, setLens] = useState<Lens>('health')
  const map = result?.ok ? result.map : null

  const layout = useMemo(() => {
    const lanes = LANES.map((_, layer) =>
      (map?.nodes ?? [])
        .filter((node) => node.layer === layer)
        .sort((a, b) => a.namespace.localeCompare(b.namespace) || a.name.localeCompare(b.name))
    )
    const positions = new Map<string, { x: number; y: number }>()
    lanes.forEach((nodes, layer) =>
      nodes.forEach((node, index) =>
        positions.set(node.id, {
          x: PAD + 84 + index * (NODE_W + GAP_X),
          y: PAD + layer * LANE_H + (LANE_H - NODE_H) / 2
        })
      )
    )
    const widest = Math.max(1, ...lanes.map((nodes) => nodes.length))
    return {
      positions,
      width: PAD * 2 + 84 + widest * (NODE_W + GAP_X),
      height: PAD * 2 + 4 * LANE_H
    }
  }, [map])

  const node = map?.nodes.find((candidate) => candidate.id === selected) ?? null
  const hit = useMemo(
    () => (map && node && lens === 'blast' ? upstreamOf(map, node.id) : null),
    [map, node, lens]
  )
  if (!kube) {
    return null
  }
  const run = (command: string): void =>
    runInWorkbenchTerminal(worktreeId, `${kubectlPrefix}${command}`)

  return (
    <InfraCard
      className="mb-4"
      title={translate('components.devops.map.title', 'System map · {{context}}', {
        context: kube.context
      })}
      hint={translate(
        'components.devops.map.hint',
        'Live from the cluster, read-only. Click a node to inspect it.'
      )}
    >
      <div className="mb-2 flex items-center gap-1.5">
        {(['health', 'blast', 'security'] as const).map((value) => (
          <Button
            key={value}
            type="button"
            size="xs"
            variant={lens === value ? 'secondary' : 'ghost'}
            onClick={() => setLens(value)}
          >
            {value === 'health'
              ? translate('components.devops.map.health', 'Health')
              : value === 'blast'
                ? translate('components.devops.map.blast', 'Blast radius')
                : translate('components.devops.map.security', 'Security')}
          </Button>
        ))}
        <Button type="button" size="xs" variant="ghost" className="ml-auto" onClick={refresh}>
          <RefreshCw aria-hidden />
          {translate('components.devops.map.refresh', 'Refresh')}
        </Button>
      </div>
      {result && !result.ok ? (
        <p className="text-xs text-destructive">{result.error}</p>
      ) : map && map.nodes.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {translate(
            'components.devops.map.empty',
            'The cluster has nothing outside system namespaces yet. Try a demo below.'
          )}
        </p>
      ) : (
        <div className="flex flex-col gap-3 lg:flex-row">
          <div className="scrollbar-sleek min-w-0 flex-1 overflow-x-auto rounded-md border border-border bg-background">
            <svg width={layout.width} height={layout.height} className="block" role="img">
              {LANES.map((lane, layer) => (
                <text
                  key={lane}
                  x={PAD}
                  y={PAD + layer * LANE_H + LANE_H / 2 + 4}
                  className="fill-muted-foreground text-[10px] uppercase"
                >
                  {lane}
                </text>
              ))}
              {map?.edges.map((edge) => {
                const from = layout.positions.get(edge.from)
                const to = layout.positions.get(edge.to)
                if (!from || !to) {
                  return null
                }
                const lit =
                  hit &&
                  (hit.has(edge.from) || edge.from === selected) &&
                  (hit.has(edge.to) || edge.to === selected)
                const x1 = from.x + NODE_W / 2
                const y1 = from.y + NODE_H
                const x2 = to.x + NODE_W / 2
                const y2 = to.y
                return (
                  <path
                    key={`${edge.from}>${edge.to}`}
                    d={`M${x1},${y1} C${x1},${(y1 + y2) / 2} ${x2},${(y1 + y2) / 2} ${x2},${y2}`}
                    fill="none"
                    className={cn(
                      lit ? 'stroke-destructive' : 'stroke-border',
                      hit && !lit && 'opacity-30'
                    )}
                    strokeWidth={lit ? 2 : 1.25}
                  />
                )
              })}
              {map?.nodes.map((item) => {
                const at = layout.positions.get(item.id)
                if (!at) {
                  return null
                }
                const dim =
                  (hit && item.id !== selected && !hit.has(item.id)) ||
                  (lens === 'security' && item.layer !== 2)
                const dot =
                  lens === 'security'
                    ? item.risks.length === 0
                      ? 'ok'
                      : item.risks.length > 2
                        ? 'bad'
                        : 'warn'
                    : item.health
                return (
                  <g
                    key={item.id}
                    transform={`translate(${at.x},${at.y})`}
                    className={cn('cursor-pointer', dim && 'opacity-30')}
                    onClick={() => setSelected(item.id === selected ? null : item.id)}
                    data-map-node={item.id}
                  >
                    <rect
                      width={NODE_W}
                      height={NODE_H}
                      rx={7}
                      className={cn(
                        'fill-card',
                        item.id === selected
                          ? 'stroke-primary'
                          : hit?.has(item.id)
                            ? 'stroke-destructive'
                            : 'stroke-border'
                      )}
                      strokeWidth={item.id === selected ? 2 : 1}
                    />
                    <circle
                      cx={NODE_W - 11}
                      cy={11}
                      r={4}
                      fill="currentColor"
                      className={HEALTH_CLASS[dot]}
                    />
                    <text x={9} y={15} className="fill-muted-foreground text-[9px] uppercase">
                      {item.kind} · {item.namespace}
                    </text>
                    <text x={9} y={32} className="fill-foreground text-[11px]">
                      {item.name.length > 22 ? `${item.name.slice(0, 21)}…` : item.name}
                    </text>
                  </g>
                )
              })}
            </svg>
          </div>
          {node ? (
            <aside
              className="w-full shrink-0 rounded-md border border-border p-3 lg:w-64"
              data-map-inspector=""
            >
              <div className="text-[10px] uppercase text-muted-foreground">
                {node.kind} · {node.namespace}
              </div>
              <div className="truncate text-sm font-semibold">{node.name}</div>
              <div className={cn('mt-1 text-xs', HEALTH_CLASS[node.health])}>{node.detail}</div>
              {lens === 'security' && node.risks.length > 0 ? (
                <ul className="mt-2 space-y-0.5 text-xs text-status-warning">
                  {node.risks.map((risk) => (
                    <li key={risk}>• {risk}</li>
                  ))}
                </ul>
              ) : null}
              {lens === 'blast' && hit ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  {translate(
                    'components.devops.map.blastCount',
                    '{{count}} things depend on this.',
                    {
                      count: hit.size
                    }
                  )}
                </p>
              ) : null}
              <div className="mt-3 flex flex-wrap gap-1.5">
                {node.kind !== 'Secret' &&
                node.kind !== 'ConfigMap' &&
                node.kind !== 'Ingress' &&
                node.kind !== 'Service' ? (
                  <Button
                    type="button"
                    size="xs"
                    variant="outline"
                    onClick={() => run(`kubectl logs ${kubectlRef(node)} -f --tail=200`)}
                  >
                    <ScrollText aria-hidden />
                    {translate('components.devops.map.logs', 'Logs')}
                  </Button>
                ) : null}
                <Button
                  type="button"
                  size="xs"
                  variant="outline"
                  onClick={() => run(`kubectl describe ${kubectlRef(node)}`)}
                >
                  <FileText aria-hidden />
                  {translate('components.devops.map.describe', 'Describe')}
                </Button>
                <Button
                  type="button"
                  size="xs"
                  variant="outline"
                  onClick={() =>
                    draftForClaude(
                      worktreeId,
                      `Look at ${node.kind} ${node.namespace}/${node.name} in context ${kube.context} (${node.detail}). Explain what it does, what depends on it, and diagnose anything unhealthy. Read-only unless I approve a change.`
                    )
                  }
                >
                  <MessageSquare aria-hidden />
                  {translate('components.devops.map.ask', 'Ask Claude')}
                </Button>
              </div>
            </aside>
          ) : null}
        </div>
      )}
    </InfraCard>
  )
}
