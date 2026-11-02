import { useCallback, useEffect, useState } from 'react'
import { Monitor, RefreshCw, Ship, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAppStore } from '@/store'
import { selectKnownWorktreeById } from '@/store/selectors'
import { translate } from '@/i18n/i18n'
import { runInWorkbenchTerminal } from '../workbench/workbench-terminals'
import type { DevopsSandbox } from './use-devops-sandbox'
import { InfraCard } from './InfraHomeCards'
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
  removeLabel
}: {
  icon: typeof Ship
  label: string
  detail: string
  onRemove: () => void
  removeLabel: string
}): React.JSX.Element {
  const [armed, setArmed] = useState(false)
  return (
    <li className="flex items-center gap-2 py-1 text-sm">
      <Icon className="size-4 shrink-0 text-status-success" aria-hidden />
      <span className="min-w-0 truncate font-mono">{label}</span>
      <span className="shrink-0 text-xs text-muted-foreground">{detail}</span>
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
              detail={`${item.kind} · ${item.state}`}
              removeLabel={remove}
              onRemove={() => {
                runInWorkbenchTerminal(worktreeId, item.remove)
                window.setTimeout(refresh, 10_000)
              }}
            />
          ))}
        </ul>
      )}
      <Button type="button" variant="ghost" size="xs" className="mt-1" onClick={refresh}>
        <RefreshCw aria-hidden />
        {translate('components.devops.runs.refresh', 'Refresh')}
      </Button>
    </InfraCard>
  )
}
