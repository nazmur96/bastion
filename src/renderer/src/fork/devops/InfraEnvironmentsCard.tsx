import { useCallback, useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import { runInWorkbenchTerminal } from '../workbench/workbench-terminals'
import { InfraCard } from './InfraHomeCards'
import { TONE_CLASS } from './DevopsContextBar'
import type { EnvironmentsResult } from '../../../../shared/fork-devops-environments'

/** The app in every cluster context side by side: what runs where, at which version. */
export function InfraEnvironmentsCard({
  worktreeId,
  workspacePath,
  namespace,
  commandLine
}: {
  worktreeId: string
  workspacePath: string
  namespace: string
  commandLine: (command: string) => string
}): React.JSX.Element | null {
  const [result, setResult] = useState<EnvironmentsResult | null>(null)
  const [armed, setArmed] = useState<string | null>(null)
  const load = useCallback(() => {
    void window.api.aiVault.environments({ workspacePath, namespace }).then(setResult)
  }, [workspacePath, namespace])
  useEffect(load, [load])
  if (!result?.ok || result.columns.length < 2) {
    // One context is the map's job; this card is for comparing several.
    return null
  }
  const names = [
    ...new Set(
      result.columns.flatMap((column) => column.workloads?.map((workload) => workload.name) ?? [])
    )
  ]
  return (
    <InfraCard
      id="infra-path-environments"
      className="mb-4"
      title={translate('components.devops.env.title', 'Environments · {{namespace}}', {
        namespace
      })}
      hint={translate(
        'components.devops.env.hint',
        'Every cluster in this repo’s kubeconfig, read-only. Use switches kubectl.'
      )}
    >
      <div className="scrollbar-sleek overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr>
              <th className="py-1 pr-3 text-left font-medium text-muted-foreground">
                {translate('components.devops.env.workload', 'Workload')}
              </th>
              {result.columns.map((column) => (
                <th
                  key={column.context}
                  className={cn(
                    'py-1 pr-3 text-left font-mono font-medium',
                    TONE_CLASS[column.tone]
                  )}
                >
                  <div className="flex items-center gap-1.5">
                    <span className="truncate">{column.context}</span>
                    {column.context === result.current ? (
                      <span className="text-muted-foreground">
                        {translate('components.devops.env.current', '(current)')}
                      </span>
                    ) : (
                      <Button
                        type="button"
                        size="xs"
                        variant={armed === column.context ? 'destructive' : 'ghost'}
                        onBlur={() => setArmed(null)}
                        onClick={() => {
                          if (column.tone === 'prod' && armed !== column.context) {
                            setArmed(column.context)
                            return
                          }
                          setArmed(null)
                          runInWorkbenchTerminal(
                            worktreeId,
                            commandLine(`kubectl config use-context ${column.context}`)
                          )
                          window.setTimeout(load, 3_000)
                        }}
                      >
                        {armed === column.context
                          ? translate(
                              'components.devops.env.confirmProd',
                              'Click again: production'
                            )
                          : translate('components.devops.env.use', 'Use')}
                      </Button>
                    )}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {names.length === 0 ? (
              <tr>
                <td colSpan={result.columns.length + 1} className="py-2 text-muted-foreground">
                  {translate(
                    'components.devops.env.none',
                    'Nothing deployed in {{namespace}} on any cluster yet.',
                    { namespace }
                  )}
                </td>
              </tr>
            ) : (
              names.map((name) => (
                <tr key={name} className="border-t border-border">
                  <td className="py-1 pr-3 font-mono">{name}</td>
                  {result.columns.map((column) => {
                    const workload = column.workloads?.find((candidate) => candidate.name === name)
                    return (
                      <td key={column.context} className="py-1 pr-3 font-mono" title={column.error}>
                        {column.workloads === null ? (
                          <span className="text-muted-foreground">
                            {translate('components.devops.env.down', 'not answering')}
                          </span>
                        ) : workload ? (
                          <span
                            className={
                              workload.ready >= workload.desired
                                ? 'text-status-success'
                                : 'text-status-warning'
                            }
                          >
                            {workload.ready}/{workload.desired} · {workload.image}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                    )
                  })}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <Button type="button" size="xs" variant="ghost" className="mt-2" onClick={load}>
        <RefreshCw aria-hidden />
        {translate('components.devops.env.refresh', 'Refresh')}
      </Button>
    </InfraCard>
  )
}
