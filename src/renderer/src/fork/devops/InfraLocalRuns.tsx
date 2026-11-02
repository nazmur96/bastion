import { useCallback, useEffect, useState } from 'react'
import { LogOut, Monitor, RefreshCw, Ship, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store'
import { selectKnownWorktreeById } from '@/store/selectors'
import { translate } from '@/i18n/i18n'
import { runInWorkbenchTerminal } from '../workbench/workbench-terminals'
import type { DevopsSandbox } from './use-devops-sandbox'
import { InfraCard } from './InfraHomeCards'
import { forgetLaunched, readLaunched } from './launched-store'
import type { LocalRun } from '../../../../shared/fork-devops-local-runs'

const REFRESH_MS = 20_000

function useLocalRuns(path: string | undefined): { runs: LocalRun[] | null; refresh: () => void } {
  const [runs, setRuns] = useState<LocalRun[] | null>(null)
  const [round, setRound] = useState(0)
  useEffect(() => {
    if (!path) {
      return
    }
    let current = true
    const load = (): void => {
      void window.api.aiVault.listLocalRuns(path).then((next) => {
        if (current) {
          setRuns(next)
        }
      })
    }
    load()
    const timer = window.setInterval(load, REFRESH_MS)
    return () => {
      current = false
      window.clearInterval(timer)
    }
  }, [path, round])
  return { runs, refresh: useCallback(() => setRound((value) => value + 1), []) }
}

function Row({
  icon: Icon,
  label,
  detail,
  onRemove,
  removeLabel,
  down = false
}: {
  icon: typeof Ship
  label: string
  detail: string
  /** The cluster exists but its API does not answer. */
  down?: boolean
  onRemove: () => void
  removeLabel: string
}): React.JSX.Element {
  const [armed, setArmed] = useState(false)
  return (
    <li className="flex items-center gap-2 py-1 text-sm">
      <Icon
        className={cn('size-4 shrink-0', down ? 'text-destructive' : 'text-status-success')}
        aria-hidden
      />
      <span className="min-w-0 truncate font-mono">{label}</span>
      <span
        className={cn('shrink-0 text-xs', down ? 'text-destructive' : 'text-muted-foreground')}
        title={
          down
            ? translate(
                'components.devops.runs.downHint',
                'The containers run but the Kubernetes API does not answer. A Docker restart often breaks multi-control-plane kind clusters; remove it and launch again.'
              )
            : undefined
        }
      >
        {detail}
      </span>
      <Button
        type="button"
        variant={armed ? 'destructive' : 'ghost'}
        size="xs"
        className="ml-auto shrink-0"
        onBlur={() => setArmed(false)}
        onClick={() => {
          if (armed) {
            setArmed(false)
            onRemove()
          } else {
            setArmed(true)
          }
        }}
      >
        <Trash2 aria-hidden />
        {armed ? translate('components.devops.runs.confirm', 'Click again') : removeLabel}
      </Button>
    </li>
  )
}

/** Everything local the Launchpad can start, in one list with a way to stop it. */
export function InfraLocalRuns({
  worktreeId,
  sandbox
}: {
  worktreeId: string
  sandbox: DevopsSandbox
}): React.JSX.Element {
  const path = useAppStore((state) => selectKnownWorktreeById(state, worktreeId)?.path)
  const { runs, refresh } = useLocalRuns(path)
  const { awsEnv, cluster } = sandbox.state
  const remove = translate('components.devops.runs.remove', 'Remove')
  const stop = translate('components.devops.runs.stop', 'Stop')
  const empty = runs !== null && runs.length === 0 && !awsEnv && !cluster
  const launched = readLaunched()
  const startedHere = (runs ?? []).filter((item) =>
    launched.some((entry) => entry.kind === item.kind && entry.name === item.name)
  )
  const [ending, setEnding] = useState(false)
  const endSession = (): void => {
    if (!ending) {
      setEnding(true)
      return
    }
    setEnding(false)
    runInWorkbenchTerminal(worktreeId, startedHere.map((item) => item.remove).join(' ; '))
    startedHere.forEach((item) => forgetLaunched(item))
    window.setTimeout(refresh, 15_000)
  }
  return (
    <InfraCard
      className="mb-4"
      title={translate('components.devops.runs.title', 'Running on this machine')}
      hint={translate(
        'components.devops.runs.hint',
        'Clusters, VMs and local AWS from any workspace. Remove what you are done with.'
      )}
    >
      {empty ? (
        <p className="text-xs text-muted-foreground">
          {translate('components.devops.runs.empty', 'Nothing running. Launch something above.')}
        </p>
      ) : (
        <ul>
          {awsEnv ? (
            <Row
              icon={Monitor}
              label="floci"
              detail={translate('components.devops.runs.floci', 'local AWS')}
              removeLabel={stop}
              onRemove={() => sandbox.run('aws', 'stop')}
            />
          ) : null}
          {cluster ? (
            <Row
              icon={Ship}
              label={cluster.name}
              detail={cluster.paused ? 'vind · asleep' : 'vind'}
              removeLabel={remove}
              onRemove={() => sandbox.run('cluster', 'stop')}
            />
          ) : null}
          {(runs ?? []).map((item) => (
            <Row
              key={`${item.kind}:${item.name}`}
              icon={item.kind === 'multipass' ? Monitor : Ship}
              label={item.name}
              detail={
                (startedHere.includes(item)
                  ? `${translate('components.devops.runs.here', 'from Launchpad')} · `
                  : '') +
                (item.api === 'down'
                  ? `${item.kind} · ${translate('components.devops.runs.apiDown', 'API not answering')}`
                  : `${item.kind} · ${item.state}`)
              }
              down={item.api === 'down'}
              removeLabel={remove}
              onRemove={() => {
                runInWorkbenchTerminal(worktreeId, item.remove)
                window.setTimeout(refresh, 10_000)
              }}
            />
          ))}
        </ul>
      )}
      <div className="mt-1 flex items-center gap-2">
        <Button type="button" variant="ghost" size="xs" onClick={refresh}>
          <RefreshCw aria-hidden />
          {translate('components.devops.runs.refresh', 'Refresh')}
        </Button>
        {startedHere.length > 0 ? (
          <Button
            type="button"
            variant={ending ? 'destructive' : 'outline'}
            size="xs"
            className="ml-auto"
            onBlur={() => setEnding(false)}
            onClick={endSession}
            title={translate(
              'components.devops.runs.endHint',
              'Removes only the clusters and VMs the Launchpad started; stop Floci and vind on their rows.'
            )}
          >
            <LogOut aria-hidden />
            {ending
              ? translate('components.devops.runs.endConfirm', 'Click again to remove {{count}}', {
                  count: startedHere.length
                })
              : translate('components.devops.runs.end', 'End session')}
          </Button>
        ) : null}
      </div>
    </InfraCard>
  )
}
