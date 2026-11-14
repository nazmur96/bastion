import { SourceChecksPanel } from './SourceChecksPanel'
import { useEffect, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { useAppStore } from '@/store'
import { createBrowserUuid } from '@/lib/browser-uuid'
import { translate, getIntlLocale } from '@/i18n/i18n'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { subscribeRuntimeFileChanges } from '@/runtime/runtime-file-watch-client'
import {
  type ChangeRecord,
  type ChangeIntent,
  SOURCE_CHECK_INTENT
} from '../../../../shared/fork-changes/change-contract'
import { startWorkspaceHost } from '../workbench/start-project-actions'
import { changedProjectPaths } from '../discovery/use-project-discovery'
import { captureSourceCheckOwner } from './source-check-owner'
import { changeEntrance, changeInitialPaths, changeInitialIntent } from './change-navigation'
import { changesApi } from './change-channel'
import { refreshOwnerRuns } from './owner-execution-client'
import { SourceProposalPanel } from './SourceProposalPanel'
import { NewSourceChangeDialog } from './NewSourceChangeDialog'
import { openProjectChange, subscribeChangeProgress } from './change-controller'
import { ChangeRunEvidence } from './ChangeRunEvidence'

export function WorkspaceChangesPage({ worktreeId }: { worktreeId: string }): React.JSX.Element {
  const hostId = useAppStore(() => startWorkspaceHost(worktreeId))
  const contextStamp = useAppStore(() => {
    try {
      return JSON.stringify(captureSourceCheckOwner(worktreeId).scope)
    } catch {
      return 'unresolved'
    }
  })
  const [record, setRecord] = useState<ChangeRecord | null>(null)
  const [intent, setIntent] = useState<ChangeIntent>(() => changeInitialIntent(worktreeId))
  const [records, setRecords] = useState<ChangeRecord[]>([])
  const [paths, setPaths] = useState('')
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const busy = !!record && busyKey === record.id
  const selectedRecordId = useRef<string | null>(null)
  selectedRecordId.current = record?.id ?? null
  const [error, setError] = useState('')
  const [freshnessUnknown, setFreshnessUnknown] = useState(true)
  const watchEpoch = useRef(0)
  const watchReady = useRef(false)
  useEffect(() => {
    let live = true
    let stopWatch: (() => void) | undefined
    setRecord(null)
    setError('')
    setFreshnessUnknown(true)
    watchEpoch.current++
    watchReady.current = false
    const stopProgress = subscribeChangeProgress((next) => {
      if (live) {
        setRecord((current) => (current?.id === next.id ? next : current))
      }
    })
    void openProjectChange(worktreeId, changeEntrance(), intent)
      .then((next) => {
        if (live) {
          setRecord((current) =>
            current?.id === next.id && current.revision > next.revision ? current : next
          )
          setPaths(
            next.validations
              .at(-1)
              ?.snapshot.files.map((file) => file.path)
              .join('\n') ?? changeInitialPaths(worktreeId).join('\n')
          )
          void changesApi()
            .list({ projectId: worktreeId })
            .then((items) => {
              if (live) {
                setRecords(items)
              }
            })
            .catch(() => {})
        }
      })
      .catch((failure: unknown) => {
        if (live) {
          setError(failure instanceof Error ? failure.message : String(failure))
        }
      })
    try {
      const owner = captureSourceCheckOwner(worktreeId)
      void subscribeRuntimeFileChanges(
        owner.context,
        (payload) => {
          const changed = changedProjectPaths(payload, owner.scope.root)
          if (live && (changed === null || changed.length > 0)) {
            watchEpoch.current++
            setFreshnessUnknown(true)
          }
        },
        () => {
          if (live) {
            watchReady.current = false
            watchEpoch.current++
            setFreshnessUnknown(true)
          }
        },
        () => {
          if (live) {
            watchReady.current = true
          }
        }
      )
        .then((stop) => {
          if (live) {
            stopWatch = stop
          } else {
            stop()
          }
        })
        .catch(() => {
          if (live) {
            setFreshnessUnknown(true)
          }
        })
    } catch {
      setFreshnessUnknown(true)
    }
    return () => {
      live = false
      stopWatch?.()
      stopProgress()
    }
  }, [worktreeId, hostId, contextStamp, intent])
  useEffect(() => {
    if (!record || busy || !record.runs.some((run) => run.execution && run.status === 'running')) {
      return
    }
    let live = true
    let pending = false
    const timer = setInterval(() => {
      if (pending) {
        return
      }
      pending = true
      void refreshOwnerRuns(record)
        .then((next) => {
          if (live) {
            setRecord((current) => (current?.id === next.id ? next : current))
          }
        })
        .catch((failure: unknown) => {
          if (live) {
            setError(failure instanceof Error ? failure.message : String(failure))
          }
        })
        .finally(() => {
          pending = false
        })
    }, 1000)
    return () => {
      live = false
      clearInterval(timer)
    }
  }, [record, busy])
  const perform = (operation: () => Promise<ChangeRecord>, sourceRead = true): void => {
    const operationRecordId = record?.id
    if (!operationRecordId) {
      return
    }
    const epoch = watchEpoch.current
    setBusyKey(operationRecordId)
    setError('')
    void operation()
      .then((next) => {
        setRecord((current) => (current?.id === next.id ? next : current))
        if (sourceRead && watchReady.current && watchEpoch.current === epoch) {
          setFreshnessUnknown(false)
        }
      })
      .catch((failure: unknown) => {
        if (selectedRecordId.current !== operationRecordId) {
          return
        }
        setFreshnessUnknown(true)
        setError(failure instanceof Error ? failure.message : String(failure))
      })
      .finally(() => setBusyKey((current) => (current === operationRecordId ? null : current)))
  }
  return (
    <div className="workspace-page scrollbar-sleek" data-workspace-changes="">
      <header className="workspace-page-heading">
        <div>
          <h1>{translate('changes.title', 'Changes & runs')}</h1>
          <p>
            {translate(
              'changes.workflowScope',
              'Prepare source, review its plan, then execute through the project owner and inspect the evidence.'
            )}
          </p>
        </div>
      </header>
      <div className="workspace-card-actions mb-5">
        <Select
          value={intent.id}
          onValueChange={(id) => {
            const next = records.find((item) => item.intent?.id === id)?.intent
            setIntent(next ?? SOURCE_CHECK_INTENT)
          }}
        >
          <SelectTrigger aria-label={translate('changes.selectChange', 'Select project change')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="source-check">
              {translate('changes.sourceChecks', 'Source checks')}
            </SelectItem>
            {records
              .filter((item) => item.intent?.id !== 'source-check')
              .map((item) => (
                <SelectItem value={item.intent?.id ?? 'source-check'} key={item.id}>
                  {item.intent?.label ??
                    (item.intent?.kind === 'create-file'
                      ? item.intent.id.slice(5)
                      : item.intent?.id)}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          onClick={() =>
            setIntent({
              id: `checks:${createBrowserUuid()}`,
              kind: 'source-check',
              label: `${translate('changes.sourceChecks', 'Source checks')} · ${new Date().toLocaleString(getIntlLocale())}`
            })
          }
        >
          {translate('changes.newChecks', 'New check change')}
        </Button>
        <NewSourceChangeDialog
          worktreeId={worktreeId}
          onPrepared={(next) => {
            if (next.intent) {
              setIntent(next.intent)
            }
          }}
        />
        <Button
          variant="outline"
          disabled={busy || !record}
          onClick={() => {
            if (record) {
              perform(() => refreshOwnerRuns(record), false)
            }
          }}
        >
          {translate('changes.refreshRuns', 'Refresh run evidence')}
        </Button>
      </div>
      {error && (
        <p role="alert" className="mb-4 text-destructive">
          {error}
        </p>
      )}
      {busy && (
        <p role="status" className="mb-4 flex items-center gap-2">
          <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />
          {translate('changes.readingOwner', 'Reading selected source through the project owner…')}
        </p>
      )}
      {!record && !error && (
        <p role="status">{translate('changes.loading', 'Opening project change…')}</p>
      )}
      {record && (
        <>
          <section className="workspace-card mb-5">
            <h2>{translate('changes.owner', 'Pinned project & target')}</h2>
            <p className="break-all font-mono text-xs">
              {record.scope.root} · {record.scope.hostId}
            </p>
            <p className="break-all font-mono text-xs">{record.id}</p>
            <p>
              {record.intent?.targetMode === 'selected-cloud'
                ? 'Target: repository source with an explicit Floci AWS binding. The prepared plan records its selection and instance; no cloud operation is run.'
                : translate(
                    'changes.repositoryTarget',
                    'Target: repository source. Cloud bindings are separate. Files remain ordinary project files; the ledger stores references and results.'
                  )}
            </p>
          </section>
          {record.intent?.kind === 'create-file' ? (
            <SourceProposalPanel key={record.id} record={record} busy={busy} perform={perform} />
          ) : (
            <SourceChecksPanel
              record={record}
              busy={busy}
              paths={paths}
              setPaths={setPaths}
              freshnessUnknown={freshnessUnknown}
              setFreshnessUnknown={setFreshnessUnknown}
              setError={setError}
              perform={perform}
            />
          )}
          <section className="mb-5">
            <h2 className="mb-3 font-medium">
              {translate('changes.attempts', '3. Run evidence & source verification')}
            </h2>
            <div className="space-y-3">
              {record.runs.toReversed().map((run) => (
                <ChangeRunEvidence key={run.id} run={run} />
              ))}
            </div>
            {!record.runs.length && (
              <p>{translate('changes.noRuns', 'No source-check attempts yet.')}</p>
            )}
          </section>
        </>
      )}
    </div>
  )
}
