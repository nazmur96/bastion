import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { getIntlLocale } from '@/i18n/i18n'
import { createBrowserUuid } from '@/lib/browser-uuid'
import { capabilityNote } from '../../../../shared/fork-cloud/operation-capabilities'
import type { DeliveryConfig } from '../../../../shared/fork-delivery/delivery-contract'
import type { VerificationRun } from '../../../../shared/fork-delivery/operations-contract'
import {
  RECURRING_MAX_TASKS,
  RECURRING_MIN_MINUTES,
  missedRuns,
  nextDue,
  recurringCheckSchema,
  type RecurringCheck,
  type RecurringTask
} from '../../../../shared/fork-delivery/recurring-contract'
import { ownerOperation } from './operations-owner-client'
import { saveRecurringTasks, useRecurringTasks, useRunnerState } from './recurring-tasks'

const input = 'rounded-md border border-input bg-background px-2 py-1 font-mono text-sm'
type Kind = RecurringCheck['check']
const KINDS: Kind[] = ['journey', 'certificates', 'backups']
const FIELDS: Record<Kind, [string, string, string][]> = {
  journey: [
    ['service', 'Service', 'web'],
    ['port', 'Port', '80'],
    ['path', 'Path', '/'],
    ['expect', 'Expected text', 'ok']
  ],
  certificates: [
    ['endpoints', 'Endpoints', 'app.example.com'],
    ['warnDays', 'Warn within (days)', '21']
  ],
  backups: [
    ['veleroNamespace', 'Velero namespace', 'velero'],
    ['staleHours', 'Stale after (hours)', '26'],
    ['drillDays', 'Drill due after (days)', '90']
  ]
}
const at = (time: number) => new Date(time).toLocaleString(getIntlLocale())

function build(
  kind: Kind,
  config: DeliveryConfig,
  values: Record<string, string>
): RecurringCheck | null {
  const value = (name: string) =>
    values[name] || (FIELDS[kind].find(([key]) => key === name)?.[2] ?? '')
  const candidate =
    kind === 'journey'
      ? {
          ...config,
          check: kind,
          journey: {
            // No defaults for a journey: an unfilled field leaves the task invalid.
            service: values.service ?? '',
            port: Number(values.port ?? ''),
            path: values.path ?? '',
            expect: values.expect ?? ''
          }
        }
      : kind === 'certificates'
        ? {
            ...config,
            check: kind,
            endpoints: (values.endpoints ?? '').split(/[\s,]+/).filter(Boolean),
            warnDays: Number(value('warnDays'))
          }
        : {
            ...config,
            check: kind,
            veleroNamespace: value('veleroNamespace'),
            staleHours: Number(value('staleHours')),
            drillDays: Number(value('drillDays'))
          }
  const parsed = recurringCheckSchema.safeParse(candidate)
  return parsed.success ? parsed.data : null
}

/** Fork: Step 14.5 recurring read-only checks, run while this project's workspace is open. */
export function DeliveryRecurringSection({
  projectId,
  config
}: {
  projectId: string
  config: DeliveryConfig | null
}): React.JSX.Element {
  const tasks = useRecurringTasks(projectId)
  const runner = useRunnerState()
  const [runs, setRuns] = useState<VerificationRun[]>([])
  const [kind, setKind] = useState<Kind>('journey')
  const [label, setLabel] = useState('')
  const [every, setEvery] = useState('15')
  const [values, setValues] = useState<Record<string, string>>({})
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    let current = true
    void ownerOperation(projectId, 'operations.runs', { projectId }, async () =>
      window.api.cloudTargets?.operations?.runs({ projectId })
    ).then((result) => {
      if (current && result?.ok) {
        setRuns(result.runs)
        setNow(Date.now())
      }
    })
    return () => {
      current = false
    }
  }, [projectId, runner.revision])
  const minutes = Number(every)
  const request = config ? build(kind, config, values) : null
  const valid =
    request !== null &&
    label.trim().length > 0 &&
    Number.isInteger(minutes) &&
    minutes >= RECURRING_MIN_MINUTES &&
    minutes <= 1440 &&
    tasks.length < RECURRING_MAX_TASKS
  const update = (next: RecurringTask[]) => saveRecurringTasks(projectId, next)
  const add = () => {
    if (!valid || !request) {
      return
    }
    update([
      ...tasks,
      {
        id: createBrowserUuid(),
        label: label.trim(),
        everyMinutes: minutes,
        enabled: true,
        request
      }
    ])
    setLabel('')
  }
  return (
    <section className="workspace-card space-y-3" data-testid="delivery-recurring">
      <div>
        <h2 className="text-sm font-medium">Recurring checks</h2>
        <p className="text-xs text-muted-foreground">
          Journey, certificate and backup checks on an interval, only while this project&apos;s
          workspace is open. Read-only; every run joins the run history. Runs missed while the
          workspace was closed are shown as missed, never filled in.
        </p>
      </div>
      <div className="grid gap-2 sm:grid-cols-4">
        <label className="flex flex-col gap-1 text-xs">
          Check
          <select
            className={input}
            aria-label="Check type"
            value={kind}
            onChange={(event) => {
              const next = KINDS.find((item) => item === event.target.value)
              if (next) {
                setKind(next)
              }
              setValues({})
            }}
          >
            <option value="journey">Journey check</option>
            <option value="certificates">Certificates</option>
            <option value="backups">Backups</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs">
          Task name
          <input
            className={input}
            value={label}
            onChange={(event) => setLabel(event.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          Every (minutes)
          <input
            className={input}
            value={every}
            onChange={(event) => setEvery(event.target.value)}
          />
        </label>
        {FIELDS[kind].map(([key, name, placeholder]) => (
          <label key={key} className="flex flex-col gap-1 text-xs">
            {name}
            <input
              className={input}
              value={values[key] ?? ''}
              placeholder={placeholder}
              onChange={(event) => setValues({ ...values, [key]: event.target.value })}
            />
          </label>
        ))}
      </div>
      <Button
        variant="outline"
        disabled={!valid}
        title={capabilityNote('operations.recurring')}
        onClick={add}
      >
        Add recurring check
      </Button>
      {runner.running && <p className="text-xs">Running · {runner.running}</p>}
      {runner.error && (
        <p role="alert" className="text-sm text-destructive">
          {runner.error}
        </p>
      )}
      <ul className="space-y-2 text-xs" aria-label="Recurring checks" data-testid="recurring-tasks">
        {tasks.map((task) => {
          const last = runs.find((run) => run.task?.id === task.id)
          const due = nextDue(runs, task)
          const gaps = missedRuns(runs, task, now)
          return (
            <li key={task.id} className="space-y-1" data-task={task.label}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{task.label}</span>
                <span>
                  {task.request.check} · every {task.everyMinutes} min
                </span>
                <label className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={task.enabled}
                    onChange={(event) =>
                      update(
                        tasks.map((item) =>
                          item.id === task.id ? { ...item, enabled: event.target.checked } : item
                        )
                      )
                    }
                  />
                  Enabled
                </label>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => update(tasks.filter((item) => item.id !== task.id))}
                >
                  Remove
                </Button>
              </div>
              <p className="font-mono break-all">
                {last ? (
                  <>
                    <Badge variant={last.passed ? 'secondary' : 'outline'}>
                      {last.passed ? 'passed' : 'failed'}
                    </Badge>{' '}
                    last run {at(last.at)} · {last.detail}
                  </>
                ) : (
                  'Not run yet'
                )}
                {task.enabled ? ` · next ${due === 0 ? 'now' : at(due)}` : ' · paused'}
              </p>
              {gaps.map((gap) => (
                <p key={gap.from} data-missed={gap.missed}>
                  Missed {gap.missed} run{gap.missed === 1 ? '' : 's'} between {at(gap.from)} and{' '}
                  {at(gap.to)} (workspace closed or task paused)
                </p>
              ))}
            </li>
          )
        })}
        {tasks.length === 0 && <li>No recurring checks.</li>}
      </ul>
    </section>
  )
}
