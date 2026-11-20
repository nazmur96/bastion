import { useCallback, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { getIntlLocale } from '@/i18n/i18n'
import { capabilityNote } from '../../../../shared/fork-cloud/operation-capabilities'
import type { DeliveryConfig } from '../../../../shared/fork-delivery/delivery-contract'
import {
  journeyCheckSchema,
  type RunbookSummary,
  type VerificationRun,
  type WorkloadDiagnosis
} from '../../../../shared/fork-delivery/operations-contract'
import { runbookDraft, runbookName } from '../../../../shared/fork-delivery/runbook-draft'
import { ownerOperation } from './operations-owner-client'
import { useRunnerState } from './recurring-tasks'

const input = 'rounded-md border border-input bg-background px-2 py-1 font-mono text-sm'
type CheckForm = { service: string; port: string; path: string; expect: string }
const CHECK_FIELDS: [keyof CheckForm, string, string][] = [
  ['service', 'Service', 'my-app'],
  ['port', 'Port', '80'],
  ['path', 'Path', '/'],
  ['expect', 'Expected text', 'ok']
]

/** Fork: Step 12 journey checks (append-only history), runbooks and recorded recovery drills. */
export function DeliveryVerificationSection({
  projectId,
  config,
  diagnosis
}: {
  projectId: string
  config: DeliveryConfig | null
  diagnosis: WorkloadDiagnosis | null
}): React.JSX.Element {
  const [check, setCheck] = useState<CheckForm>({ service: '', port: '80', path: '/', expect: '' })
  const [runs, setRuns] = useState<VerificationRun[]>([])
  const [runbooks, setRunbooks] = useState<RunbookSummary[]>([])
  const [drillRunbook, setDrillRunbook] = useState('')
  const [draft, setDraft] = useState<{ title: string; content: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const parsedCheck = journeyCheckSchema.safeParse({ ...check, port: Number(check.port) })
  const api = window.api.cloudTargets?.operations
  const refresh = useCallback(async () => {
    const [history, list] = await Promise.all([
      ownerOperation(projectId, 'operations.runs', { projectId }, async () =>
        api?.runs({ projectId })
      ),
      api?.runbooks({ projectId })
    ])
    if (history?.ok) {
      setRuns(history.runs)
    }
    if (list?.ok) {
      setRunbooks(list.runbooks)
    }
  }, [api, projectId])
  // Recurring runs land in the same history; refresh when the runner records one.
  const recorded = useRunnerState().revision
  useEffect(() => {
    void refresh()
  }, [refresh, recorded])

  const verify = async (kind: 'check' | 'drill'): Promise<void> => {
    if (!config || !parsedCheck.success) {
      return
    }
    setBusy(true)
    setMessage(null)
    try {
      const request = {
        ...config,
        check: parsedCheck.data,
        kind,
        runbook: kind === 'drill' ? drillRunbook || null : null
      }
      const result = await ownerOperation(projectId, 'operations.verify', request, async () =>
        api?.verify(request)
      )
      setMessage(result?.ok ? null : (result?.message ?? 'Checks are unavailable in this client.'))
      await refresh()
    } finally {
      setBusy(false)
    }
  }
  const save = async (): Promise<void> => {
    if (!draft) {
      return
    }
    setBusy(true)
    try {
      const result = await api?.createRunbook({
        projectId,
        name: runbookName(draft.title),
        content: draft.content
      })
      if (result?.ok) {
        setDraft(null)
        setMessage(`Created ${result.path}. Commit it with Source Control so it is kept in Git.`)
        await refresh()
      } else {
        setMessage(result?.message ?? 'Runbooks are unavailable in this client.')
      }
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="workspace-card space-y-3" data-testid="delivery-verification">
      <div>
        <h2 className="text-sm font-medium">Verify and recover</h2>
        <p className="text-xs text-muted-foreground">
          A journey check sends one GET to a service through the cluster API and passes when the
          response contains the expected text. Every run is kept, failed ones included.
        </p>
      </div>
      <div className="grid gap-2 sm:grid-cols-4">
        {CHECK_FIELDS.map(([key, label, placeholder]) => (
          <label key={key} className="flex flex-col gap-1 text-xs">
            {label}
            <input
              className={input}
              value={check[key]}
              placeholder={placeholder}
              onChange={(event) => setCheck({ ...check, [key]: event.target.value })}
            />
          </label>
        ))}
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <Button
          variant="outline"
          disabled={busy || !config || !parsedCheck.success}
          title={capabilityNote('operations.verify')}
          onClick={() => void verify('check')}
        >
          Run journey check
        </Button>
        <label className="flex flex-col gap-1 text-xs">
          Drill runbook
          <select
            className={input}
            value={drillRunbook}
            onChange={(event) => setDrillRunbook(event.target.value)}
          >
            <option value="">Choose a runbook</option>
            {runbooks.map((runbook) => (
              <option key={runbook.path} value={runbook.path}>
                {runbook.title}
              </option>
            ))}
          </select>
        </label>
        <Button
          variant="outline"
          disabled={busy || !config || !parsedCheck.success || !drillRunbook}
          title="Run after the runbook's recovery steps; the check result is recorded as the drill's result"
          onClick={() => void verify('drill')}
        >
          Record drill result
        </Button>
        <Button
          variant="outline"
          disabled={busy || !diagnosis || !config}
          title={capabilityNote('runbooks.create')}
          onClick={() =>
            diagnosis &&
            config &&
            setDraft({
              title: 'New runbook',
              content: runbookDraft({
                title: 'New runbook',
                application: config.application,
                diagnosis,
                check: parsedCheck.success ? parsedCheck.data : null,
                runs
              })
            })
          }
        >
          Draft runbook from diagnosis…
        </Button>
      </div>
      {message && (
        <p role="status" className="text-sm">
          {message}
        </p>
      )}
      <ol className="space-y-1 text-xs" aria-label="Verification runs" data-testid="runs">
        {runs.map((run) => (
          <li key={run.id} className="font-mono break-all">
            <Badge variant={run.passed ? 'secondary' : 'outline'}>
              {run.passed ? 'passed' : 'failed'}
            </Badge>{' '}
            {run.kind} · {new Date(run.at).toLocaleString(getIntlLocale())} · revision{' '}
            {run.revision?.slice(0, 12) ?? 'mixed or unknown'} · {run.target}
            {run.runbook ? ` · ${run.runbook}` : ''} · {run.detail}
          </li>
        ))}
        {runs.length === 0 && <li>No runs recorded yet.</li>}
      </ol>
      <ul className="text-xs" aria-label="Runbooks">
        {runbooks.map((runbook) => (
          <li key={runbook.path}>
            {runbook.title} · <span className="font-mono">{runbook.path}</span>
          </li>
        ))}
        {runbooks.length === 0 && <li>No runbooks in this repository yet.</li>}
      </ul>
      {draft && (
        <Dialog open onOpenChange={(open) => !open && setDraft(null)}>
          <DialogContent surface="security" className="max-w-3xl">
            <DialogHeader>
              <DialogTitle>Review the runbook before saving it</DialogTitle>
            </DialogHeader>
            <label className="flex flex-col gap-1 text-xs">
              Title
              <input
                className={input}
                value={draft.title}
                onChange={(event) =>
                  setDraft({
                    title: event.target.value,
                    content: draft.content.replace(/^# .*$/m, `# ${event.target.value}`)
                  })
                }
              />
            </label>
            <textarea
              aria-label="Runbook content"
              className={`${input} h-[40vh]`}
              value={draft.content}
              onChange={(event) => setDraft({ ...draft, content: event.target.value })}
            />
            <p className="text-xs text-muted-foreground">
              Creates runbooks/{runbookName(draft.title)}.md as a new file; an existing runbook is
              never overwritten. Logs in the draft are already masked, so review them anyway.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setDraft(null)}>
                Cancel
              </Button>
              <Button disabled={busy} onClick={() => void save()}>
                Create runbook
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </section>
  )
}
