import { useEffect, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { SecuritySurface } from '@/components/ui/security-surface'
import { subscribeRuntimeFileChanges } from '@/runtime/runtime-file-watch-client'
import {
  currentChangeReview,
  type ChangeRecord
} from '../../../../shared/fork-changes/change-contract'
import { startWorkspaceHost } from '../workbench/start-project-actions'
import { showWorkspaceEditor } from '../workspace-desktop/WorkspaceQuickActions'
import { openWorkspaceFile } from '../devops/open-manifest'
import { changedProjectPaths } from '../discovery/use-project-discovery'
import { captureSourceCheckOwner } from './source-check-owner'
import { changeEntrance, changeInitialPaths } from './change-navigation'
import {
  openProjectChange,
  prepareSourceChange,
  reviewSourceChange,
  runSourceChange,
  subscribeChangeProgress
} from './change-controller'
import { ChangeRunEvidence } from './ChangeRunEvidence'

export function WorkspaceChangesPage({ worktreeId }: { worktreeId: string }): React.JSX.Element {
  const hostId = useAppStore(() => startWorkspaceHost(worktreeId))
  const [record, setRecord] = useState<ChangeRecord | null>(null)
  const [paths, setPaths] = useState('')
  const [busy, setBusy] = useState(false)
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
    void openProjectChange(worktreeId, changeEntrance())
      .then((next) => {
        if (live) {
          setRecord((current) =>
            current?.id === next.id && current.revision > next.revision ? current : next
          )
          setPaths(
            next.validations
              .at(-1)
              ?.snapshot.files.map((file) => file.path)
              .join('\n') ?? changeInitialPaths().join('\n')
          )
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
  }, [worktreeId, hostId])
  const perform = (operation: () => Promise<ChangeRecord>): void => {
    const epoch = watchEpoch.current
    setBusy(true)
    setError('')
    void operation()
      .then((next) => {
        setRecord((current) => (current?.id === next.id ? next : current))
        if (watchReady.current && watchEpoch.current === epoch) {
          setFreshnessUnknown(false)
        }
      })
      .catch((failure: unknown) => {
        setFreshnessUnknown(true)
        setError(failure instanceof Error ? failure.message : String(failure))
      })
      .finally(() => setBusy(false))
  }
  const validation = record?.validations.at(-1)
  const review = record && currentChangeReview(record)
  const running = record?.runs.some((run) => run.status === 'running')
  const disabled = busy || running || !record
  const selectionMatches =
    paths
      .trim()
      .split('\n')
      .map((path) => path.trim())
      .sort()
      .join('\n') === validation?.snapshot.files.map((file) => file.path).join('\n')
  return (
    <div className="workspace-page scrollbar-sleek" data-workspace-changes="">
      <header className="workspace-page-heading">
        <div>
          <h1>{translate('changes.title', 'Changes & runs')}</h1>
          <p>
            {translate(
              'changes.scope',
              'Prepare saved source, review the check plan, then run and verify it. Infrastructure execution adapters come later.'
            )}
          </p>
        </div>
      </header>
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
              {translate(
                'changes.sourceOnly',
                'Target: saved source only. No cloud account is selected. Files stay in the repository; this record stores fingerprints and check results.'
              )}
            </p>
          </section>
          <section className="workspace-card mb-5">
            <h2>{translate('changes.prepare', '1. Prepare source')}</h2>
            <label htmlFor="change-source-paths">
              {translate('changes.paths', 'Repository-relative files, one per line')}
            </label>
            <Textarea
              id="change-source-paths"
              variant="code"
              className="mt-2"
              value={paths}
              disabled={disabled}
              onChange={(event) => {
                setPaths(event.target.value)
                setFreshnessUnknown(true)
              }}
            />
            <p>
              {translate(
                'changes.fileLimits',
                'Up to 20 saved UTF-8 configuration files, 64 KiB each. Secret-named files, state files and symlinks are excluded. Unsaved editor buffers are not included.'
              )}
            </p>
            <Button
              variant="outline"
              disabled={disabled || !paths.trim()}
              onClick={() =>
                perform(() =>
                  prepareSourceChange(
                    record,
                    paths
                      .trim()
                      .split('\n')
                      .map((path) => path.trim())
                  )
                )
              }
            >
              {translate('changes.prepareButton', 'Prepare saved files')}
            </Button>
          </section>
          {validation && (
            <SecuritySurface>
              <section className="workspace-card mb-5">
                <h2>{translate('changes.review', '2. Review check plan')}</h2>
                <p>
                  {translate(
                    'changes.plan',
                    'Adapter source-check/v1 reads through the project owner. JSON files receive a syntax check; other files receive a bounded UTF-8 readability check. No command runs and no file is written.'
                  )}
                </p>
                {validation.snapshot.files.map((file) => (
                  <div
                    className="flex flex-wrap items-center justify-between gap-2 border-t border-border py-2"
                    key={file.path}
                  >
                    <Button
                      variant="link"
                      onClick={() => {
                        try {
                          const owner = captureSourceCheckOwner(worktreeId)
                          owner.assertCurrent()
                          if (JSON.stringify(owner.scope) !== JSON.stringify(record.scope)) {
                            throw new Error('Project owner changed.')
                          }
                          showWorkspaceEditor()
                          openWorkspaceFile(worktreeId, file.path, 1)
                        } catch {
                          setError(
                            translate(
                              'changes.ownerChanged',
                              'Project owner changed. Reopen Changes & runs.'
                            )
                          )
                        }
                      }}
                    >
                      {file.path}
                    </Button>
                    <code className="text-xs text-muted-foreground">{file.fingerprint}</code>
                  </div>
                ))}
                <p role="status">
                  {review
                    ? translate(
                        'changes.reviewed',
                        'Review recorded for this snapshot. Saved files and owner are rechecked before every run.'
                      )
                    : translate('changes.needsReview', 'Prepared snapshot needs review.')}
                </p>
                {freshnessUnknown && (
                  <p>
                    {translate(
                      'changes.freshness',
                      'Source freshness is unconfirmed. Review and Run re-read the selected files; changed source requires preparing and reviewing again.'
                    )}
                  </p>
                )}
                <div className="workspace-card-actions">
                  <Button
                    variant="outline"
                    disabled={disabled || !selectionMatches}
                    onClick={() => perform(() => reviewSourceChange(record))}
                  >
                    {translate('changes.reviewButton', 'Record source-check review')}
                  </Button>
                  <Button
                    disabled={disabled || !review || !selectionMatches}
                    onClick={() => perform(() => runSourceChange(record, () => {}))}
                  >
                    {translate('changes.runButton', 'Run source checks')}
                  </Button>
                </div>
              </section>
            </SecuritySurface>
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
