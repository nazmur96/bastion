import { useState } from 'react'
import { toast } from 'sonner'
import { translate } from '@/i18n/i18n'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { SecuritySurface } from '@/components/ui/security-surface'
import {
  currentChangeReview,
  sameChangeSnapshot,
  type ChangeRecord
} from '../../../../shared/fork-changes/change-contract'
import { openWorkspaceFile } from '../devops/open-manifest'
import { showWorkspaceEditor } from '../workspace-desktop/WorkspaceQuickActions'
import { matchingOwner } from './change-controller'
import { proposalDraft, retainProposalDraft } from './proposal-drafts'
import {
  prepareSourceProposal,
  reviewSourceProposal,
  createSourceProposal,
  proposalSnapshot
} from './source-proposal-controller'

export function SourceProposalPanel({
  record,
  busy,
  perform
}: {
  record: ChangeRecord
  busy: boolean
  perform: (operation: () => Promise<ChangeRecord>) => void
}): React.JSX.Element {
  const name = record.intent?.id.slice('file:'.length) ?? ''
  const [content, setContent] = useState(() => proposalDraft(record.scope.projectId, name) ?? '')
  const validation = record.validations.at(-1)
  let matches = false
  try {
    matches =
      !!validation &&
      sameChangeSnapshot(validation.snapshot, {
        ...proposalSnapshot(name, content),
        ownerRuntimeId: validation.snapshot.ownerRuntimeId
      })
  } catch {
    matches = false
  }
  const review = currentChangeReview(record)
  const running = record.runs.some((run) => run.status === 'running')
  const disabled = busy || running
  return (
    <SecuritySurface>
      <section className="workspace-card mb-5" data-source-proposal="">
        <h2>{translate('changes.fileProposal', 'New source file proposal')}</h2>
        <p className="font-mono">{name}</p>
        <p>
          {translate(
            'changes.createOnly',
            'Creation requires an absent destination. Existing files and symlinks cause a conflict. Review this source, then explicitly create the file through its project owner.'
          )}
        </p>
        <label htmlFor="proposal-source">
          {translate('changes.proposedContent', 'Proposed source')}
        </label>
        <Textarea
          id="proposal-source"
          variant="code"
          value={content}
          disabled={disabled}
          onChange={(event) => {
            setContent(event.target.value)
            retainProposalDraft(record.scope.projectId, name, event.target.value)
          }}
        />
        <p>
          {translate(
            'changes.proposalLifetime',
            'Proposal text stays in this renderer until written; the ledger stores its fingerprint. After a reload, reopen the template or paste the proposal again. Use references for secrets, never secret values.'
          )}
        </p>
        {validation && (
          <p className="font-mono text-xs">{validation.snapshot.files[0]?.fingerprint}</p>
        )}
        <p role="status">
          {review && matches
            ? translate(
                'changes.proposalReviewed',
                'File creation reviewed for this exact proposal and owner.'
              )
            : translate(
                'changes.proposalNeedsReview',
                'Prepare and review the current proposal before creating a file.'
              )}
        </p>
        <div className="workspace-card-actions">
          <Button
            variant="outline"
            disabled={disabled || !content}
            onClick={() => perform(() => prepareSourceProposal(record, name, content))}
          >
            {translate('changes.prepareProposal', 'Prepare file proposal')}
          </Button>
          <Button
            variant="outline"
            disabled={disabled || !matches}
            onClick={() => perform(() => reviewSourceProposal(record, name, content))}
          >
            {translate('changes.reviewProposal', 'Review file creation')}
          </Button>
          <Button
            disabled={disabled || !review || !matches}
            onClick={() => perform(() => createSourceProposal(record, name, content))}
          >
            {translate('changes.createFile', 'Create source file')}
          </Button>
          <Button
            variant="link"
            onClick={() => {
              try {
                matchingOwner(record).assertCurrent()
                showWorkspaceEditor()
                openWorkspaceFile(record.scope.projectId, name, 1)
              } catch {
                toast.error(
                  translate('changes.ownerChanged', 'Project owner changed. Reopen Changes & runs.')
                )
              }
            }}
          >
            {translate('changes.openFile', 'Open destination in editor')}
          </Button>
        </div>
      </section>
    </SecuritySurface>
  )
}
