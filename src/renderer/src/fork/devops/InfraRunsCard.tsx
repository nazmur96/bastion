import { useState } from 'react'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import { cancelRun, dismissRun, useStepsRuns, type StepsRun } from './steps-store'
import type { StepState } from '../../../../shared/fork-devops-steps'

const MARK: Record<StepState, { text: string; className: string }> = {
  waiting: { text: '·', className: 'run' },
  running: { text: '…', className: 'w' },
  done: { text: '✓', className: 'p' },
  failed: { text: '✗', className: 'e' },
  cancelled: { text: '–', className: 'run' }
}

function tailLines(text: string, count: number): string {
  return text.trimEnd().split('\n').slice(-count).join('\n')
}

function Run({ run }: { run: StepsRun }): React.JSX.Element {
  const [open, setOpen] = useState<string | null>(null)
  return (
    <div data-steps-run={run.runId}>
      {run.steps.map((step) => {
        const mark = MARK[step.state]
        const expanded = open === step.id || step.state === 'failed'
        return (
          <div key={step.id}>
            <button
              type="button"
              className="flex w-full gap-2 text-left"
              onClick={() => setOpen(open === step.id ? null : step.id)}
            >
              <span className="p">❯</span>
              <span className="min-w-0 flex-1 truncate">{step.command}</span>
              <span className={mark.className}>{mark.text}</span>
            </button>
            {step.output && (expanded || step.state === 'running') ? (
              <pre
                className={cn(
                  'scrollbar-sleek max-h-28 overflow-auto pl-4 whitespace-pre-wrap',
                  step.state === 'failed' ? 'e' : 'run'
                )}
              >
                {expanded ? step.output.trimEnd() : tailLines(step.output, 2)}
              </pre>
            ) : null}
          </div>
        )
      })}
      <div className="flex gap-3 pl-4">
        <span className={run.finished ? (run.ok ? 'p' : 'e') : 'run'}>
          {run.finished
            ? run.ok
              ? translate('components.devops.runs.okLine', '✓ {{title}}', { title: run.title })
              : translate('components.devops.runs.failedLine', '✗ {{title}} stopped', {
                  title: run.title
                })
            : translate('components.devops.runs.runningLine', '{{title}}…', { title: run.title })}
        </span>
        <button
          type="button"
          className="run ml-auto hover:text-[var(--bx-text)]"
          onClick={() => (run.finished ? dismissRun(run.runId) : cancelRun(run.runId))}
        >
          {run.finished
            ? translate('components.devops.runs.dismiss', 'Dismiss')
            : translate('components.devops.runs.cancel', 'Cancel')}
        </button>
      </div>
    </div>
  )
}

/** The live run log at the bottom of the system map: one prompt line per step, as in a terminal. */
export function InfraRunsCard(): React.JSX.Element | null {
  const runs = useStepsRuns()
  if (runs.length === 0) {
    return null
  }
  return (
    <section className="bx-log space-y-2" data-steps-runs="">
      {runs.map((run) => (
        <Run key={run.runId} run={run} />
      ))}
    </section>
  )
}
