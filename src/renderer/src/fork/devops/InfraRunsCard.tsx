import { useState } from 'react'
import {
  Check,
  ChevronDown,
  ChevronRight,
  Circle,
  CircleSlash,
  LoaderCircle,
  X
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import { cancelRun, dismissRun, useStepsRuns, type StepsRun } from './steps-store'
import type { StepState } from '../../../../shared/fork-devops-steps'

const ICON: Record<StepState, { icon: typeof Check; className: string }> = {
  waiting: { icon: Circle, className: 'text-muted-foreground' },
  running: { icon: LoaderCircle, className: 'animate-spin text-primary' },
  done: { icon: Check, className: 'text-status-success' },
  failed: { icon: X, className: 'text-destructive' },
  cancelled: { icon: CircleSlash, className: 'text-muted-foreground' }
}

function tailLines(text: string, count: number): string {
  return text.trimEnd().split('\n').slice(-count).join('\n')
}

function Run({ run }: { run: StepsRun }): React.JSX.Element {
  const [open, setOpen] = useState<number | null>(null)
  return (
    <div className="font-mono" data-steps-run={run.runId}>
      <div className="mb-1 flex items-center gap-2 font-sans text-xs">
        <span className="font-medium text-foreground">{run.title}</span>
        <span
          className={cn(
            'text-xs',
            run.finished
              ? run.ok
                ? 'text-status-success'
                : 'text-destructive'
              : 'text-muted-foreground'
          )}
        >
          {run.finished
            ? run.ok
              ? translate('components.devops.runs.ok', 'done')
              : translate('components.devops.runs.failed', 'stopped')
            : translate('components.devops.runs.running', 'running')}
        </span>
        <Button
          type="button"
          size="xs"
          variant="ghost"
          className="ml-auto"
          onClick={() => (run.finished ? dismissRun(run.runId) : cancelRun(run.runId))}
        >
          {run.finished
            ? translate('components.devops.runs.dismiss', 'Dismiss')
            : translate('components.devops.runs.cancel', 'Cancel')}
        </Button>
      </div>
      <ol className="space-y-0.5">
        {run.steps.map((step, index) => {
          const { icon: Icon, className } = ICON[step.state]
          const expanded = open === index || (step.state === 'failed' && open === null)
          return (
            <li key={step.id}>
              <button
                type="button"
                className="flex w-full items-center gap-2 text-left text-xs"
                onClick={() => setOpen(expanded ? -1 : index)}
              >
                <span className="shrink-0 text-primary">❯</span>
                <span className="min-w-0 flex-1 truncate">{step.command}</span>
                <Icon className={cn('size-3.5 shrink-0', className)} aria-hidden />
                {step.output ? (
                  expanded ? (
                    <ChevronDown className="size-3" aria-hidden />
                  ) : (
                    <ChevronRight className="size-3" aria-hidden />
                  )
                ) : null}
              </button>
              {step.output && (expanded || step.state === 'running') ? (
                <pre className="scrollbar-sleek max-h-40 overflow-auto pl-4 text-[11px] whitespace-pre-wrap text-muted-foreground">
                  {expanded ? step.output.trimEnd() : tailLines(step.output, 3)}
                </pre>
              ) : null}
            </li>
          )
        })}
      </ol>
    </div>
  )
}

/** The live run log under the system map: each step as a prompt line, failures open their output. */
export function InfraRunsCard(): React.JSX.Element | null {
  const runs = useStepsRuns()
  if (runs.length === 0) {
    return null
  }
  return (
    <section
      className="mt-3 space-y-3 rounded-md border border-border bg-muted/40 px-3 py-2"
      data-steps-runs=""
    >
      {runs.map((run) => (
        <Run key={run.runId} run={run} />
      ))}
    </section>
  )
}
