import { translate } from '@/i18n/i18n'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { SecuritySurface } from '@/components/ui/security-surface'
import {
  currentChangeReview,
  type ChangeRecord
} from '../../../../shared/fork-changes/change-contract'
import { showWorkspaceEditor } from '../workspace-desktop/WorkspaceQuickActions'
import { openWorkspaceFile } from '../devops/open-manifest'
import { captureSourceCheckOwner } from './source-check-owner'
import { prepareSourceChange, reviewSourceChange, runSourceChange } from './change-controller'
export function SourceChecksPanel({
  record,
  busy,
  paths,
  setPaths,
  freshnessUnknown,
  setFreshnessUnknown,
  setError,
  perform
}: {
  record: ChangeRecord
  busy: boolean
  paths: string
  setPaths: (value: string) => void
  freshnessUnknown: boolean
  setFreshnessUnknown: (value: boolean) => void
  setError: (value: string) => void
  perform: (operation: () => Promise<ChangeRecord>) => void
}): React.JSX.Element {
  const worktreeId = record.scope.projectId
  const validation = record.validations.at(-1)
  const review = record && currentChangeReview(record)
  const running = record.runs.some((run) => run.status === 'running')
  const disabled = busy || running || !record
  const selectionMatches =
    paths
      .trim()
      .split('\n')
      .map((path) => path.trim())
      .sort()
      .join('\n') === validation?.snapshot.files.map((file) => file.path).join('\n')

  return (
    <>
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
    </>
  )
}
