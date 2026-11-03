import { useEffect, useState } from 'react'
import { Check, Circle, CircleDot, ExternalLink, MessageSquare, Siren, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import { openInWorkbenchBrowser, runInWorkbenchTerminal } from '../workbench/workbench-terminals'
import { draftForClaude } from './ask-claude'
import { InfraCard } from './InfraHomeCards'
import type { SystemMapResult } from '../../../../shared/fork-devops-system-map'
import {
  eventsFor,
  flightStages,
  timelineWindow,
  type PullRequest,
  type StageState,
  type TimelineEvent
} from '../../../../shared/fork-devops-timeline'

type Mode = 'release' | 'time' | 'incident'

const STAGE_ICON: Record<StageState, { icon: typeof Check; className: string }> = {
  done: { icon: Check, className: 'text-status-success' },
  now: { icon: CircleDot, className: 'text-primary' },
  waiting: { icon: Circle, className: 'text-muted-foreground' },
  failed: { icon: X, className: 'text-destructive' }
}

function stageName(id: string): string {
  switch (id) {
    case 'review':
      return translate('components.devops.modes.review', 'Review')
    case 'ci':
      return translate('components.devops.modes.ci', 'CI checks')
    case 'merged':
      return translate('components.devops.modes.merged', 'Merged')
    case 'deployed':
      return translate('components.devops.modes.deployed', 'Deployed (local)')
    default:
      return translate('components.devops.modes.shipped', 'Shipped (cloud)')
  }
}

function when(at: number, now: number): string {
  const minutes = Math.round((now - at) / 60_000)
  return minutes < 60 ? `${minutes}m` : `${Math.round(minutes / 60)}h`
}

/** Release flight, Time machine and Incident mode over the same commits, events and map. */
export function InfraModesCard({
  worktreeId,
  workspacePath,
  map,
  deployed,
  shipped
}: {
  worktreeId: string
  workspacePath: string
  map: SystemMapResult | null
  deployed: boolean
  shipped: boolean
}): React.JSX.Element {
  const [events, setEvents] = useState<TimelineEvent[]>([])
  const [pr, setPr] = useState<PullRequest | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [hours, setHours] = useState(6)
  const bad = map?.ok
    ? map.map.nodes.filter((node) => node.layer === 2 && node.health !== 'ok')
    : []
  const [mode, setMode] = useState<Mode>(bad.length > 0 ? 'incident' : 'release')
  useEffect(() => {
    let current = true
    void Promise.all([
      window.api.aiVault.timeline(workspacePath),
      window.api.aiVault.pullRequest(workspacePath)
    ]).then(([nextEvents, nextPr]) => {
      if (current) {
        setEvents(nextEvents)
        setPr(nextPr)
        setNow(Date.now())
      }
    })
    return () => {
      current = false
    }
  }, [workspacePath, map])

  const windowed = timelineWindow(events, now, hours)
  const commits = events
    .filter((event) => event.kind === 'commit')
    .toSorted((a, b) => b.at - a.at)
    .slice(0, 3)
  const incident = bad.map((node) => ({
    node,
    related: eventsFor(events, node.namespace, node.name).slice(0, 4)
  }))

  return (
    <InfraCard
      id="infra-path-modes"
      className="mb-4"
      title={translate('components.devops.modes.title', 'Release · Time machine · Incident')}
      hint={translate(
        'components.devops.modes.hint',
        'This branch on its way to production, what changed when, and what is broken now.'
      )}
    >
      <div className="mb-3 flex gap-1">
        {(['release', 'time', 'incident'] as const).map((value) => (
          <Button
            key={value}
            type="button"
            size="xs"
            variant={mode === value ? 'secondary' : 'ghost'}
            onClick={() => setMode(value)}
          >
            {value === 'incident' ? (
              <Siren aria-hidden className={bad.length > 0 ? 'text-destructive' : undefined} />
            ) : null}
            {value === 'release'
              ? translate('components.devops.modes.release', 'Release flight')
              : value === 'time'
                ? translate('components.devops.modes.time', 'Time machine')
                : translate('components.devops.modes.incident', 'Incident{{badge}}', {
                    badge: bad.length > 0 ? ` (${bad.length})` : ''
                  })}
          </Button>
        ))}
      </div>

      {mode === 'release' ? (
        <div>
          <ol className="flex flex-wrap items-stretch gap-1.5">
            {flightStages(pr, deployed, shipped).map((stage) => {
              const { icon: Icon, className } = STAGE_ICON[stage.state]
              return (
                <li
                  key={stage.id}
                  className={cn(
                    'min-w-32 flex-1 rounded-md border px-2 py-1.5',
                    stage.state === 'now' ? 'border-primary' : 'border-border'
                  )}
                >
                  <div className="flex items-center gap-1.5 text-sm font-medium">
                    <Icon className={cn('size-3.5', className)} aria-hidden />
                    {stageName(stage.id)}
                  </div>
                  <div className="truncate text-[11px] text-muted-foreground">{stage.detail}</div>
                </li>
              )
            })}
          </ol>
          {pr?.url ? (
            <Button
              type="button"
              size="xs"
              variant="ghost"
              className="mt-2"
              onClick={() => openInWorkbenchBrowser(worktreeId, pr.url, `PR #${pr.number}`)}
            >
              <ExternalLink aria-hidden />
              {translate('components.devops.modes.openPr', 'Open #{{number}} {{title}}', {
                number: pr.number,
                title: pr.title
              })}
            </Button>
          ) : (
            <p className="mt-2 text-xs text-muted-foreground">
              {translate(
                'components.devops.modes.noPr',
                'No pull request for this branch (or gh is not signed in).'
              )}
            </p>
          )}
        </div>
      ) : null}

      {mode === 'time' ? (
        <div>
          <label className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
            {translate('components.devops.modes.window', 'Last {{hours}}h', { hours })}
            <input
              type="range"
              min={1}
              max={72}
              value={hours}
              onChange={(event) => setHours(Number(event.target.value))}
              className="flex-1 accent-primary"
            />
          </label>
          {windowed.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              {translate('components.devops.modes.quiet', 'Nothing happened in this window.')}
            </p>
          ) : (
            <ol className="scrollbar-sleek max-h-72 space-y-1 overflow-y-auto border-l border-border pl-3">
              {windowed.map((event) => (
                <li key={`${event.kind}:${event.ref}:${event.at}`} className="text-xs">
                  <span className="mr-2 font-mono text-muted-foreground">
                    {when(event.at, now)}
                  </span>
                  {event.kind === 'commit' ? (
                    <button
                      type="button"
                      className="hover:underline"
                      onClick={() =>
                        runInWorkbenchTerminal(worktreeId, `git show --stat ${event.ref}`)
                      }
                      title={translate('components.devops.modes.show', 'Show this commit')}
                    >
                      <span className="font-mono">{event.ref}</span> {event.title}{' '}
                      <span className="text-muted-foreground">· {event.detail}</span>
                    </button>
                  ) : (
                    <span className="text-status-warning">
                      {event.title} <span className="text-muted-foreground">· {event.detail}</span>
                    </span>
                  )}
                </li>
              ))}
            </ol>
          )}
        </div>
      ) : null}

      {mode === 'incident' ? (
        bad.length === 0 ? (
          <p className="text-xs text-status-success">
            {translate('components.devops.modes.calm', 'Every workload on the map is healthy.')}
          </p>
        ) : (
          <div className="space-y-2">
            {incident.map(({ node, related }) => (
              <div key={node.id} className="rounded-md border border-destructive/40 px-2 py-1.5">
                <div className="text-sm font-medium text-destructive">
                  {node.kind} {node.namespace}/{node.name} · {node.detail}
                </div>
                {related.map((event) => (
                  <div
                    key={`${event.ref}:${event.at}`}
                    className="truncate text-xs text-muted-foreground"
                  >
                    {when(event.at, now)} · {event.title}: {event.detail}
                  </div>
                ))}
              </div>
            ))}
            <div className="text-xs text-muted-foreground">
              {translate('components.devops.modes.recent', 'Latest commits: {{commits}}', {
                commits: commits.map((commit) => `${commit.ref} ${commit.title}`).join(' · ') || '—'
              })}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="xs"
                onClick={() =>
                  draftForClaude(
                    worktreeId,
                    [
                      'Incident: these workloads are unhealthy. Find the root cause, worst first, and propose the smallest fix (repo change or rollback). Read-only until I approve.',
                      ...incident.map(({ node, related }) =>
                        [
                          `- ${node.kind} ${node.namespace}/${node.name}: ${node.detail}`,
                          ...related.map((event) => `  ${event.title}: ${event.detail}`)
                        ].join('\n')
                      ),
                      `Latest commits: ${commits.map((commit) => `${commit.ref} ${commit.title}`).join('; ')}`
                    ].join('\n')
                  )
                }
              >
                <MessageSquare aria-hidden />
                {translate('components.devops.modes.diagnose', 'Diagnose with Claude')}
              </Button>
              <Button
                type="button"
                size="xs"
                variant="outline"
                onClick={() =>
                  document
                    .getElementById('infra-path-runbooks')
                    ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                }
              >
                {translate('components.devops.modes.runbooks', 'Runbooks')}
              </Button>
            </div>
          </div>
        )
      ) : null}
    </InfraCard>
  )
}
