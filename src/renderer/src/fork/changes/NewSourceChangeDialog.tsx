import { useState } from 'react'
import { translate } from '@/i18n/i18n'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from '@/components/ui/dialog'
import type { ChangeRecord } from '../../../../shared/fork-changes/change-contract'
import { openProjectChange } from './change-controller'
import { prepareSourceProposal, proposalSnapshot } from './source-proposal-controller'
import { retainProposalDraft } from './proposal-drafts'

export function NewSourceChangeDialog({
  worktreeId,
  onPrepared
}: {
  worktreeId: string
  onPrepared: (record: ChangeRecord) => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('bastion.service.json')
  const [content, setContent] = useState('{}\n')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const prepare = (): void => {
    setBusy(true)
    setError('')
    void (async () => {
      proposalSnapshot(name, content)
      const record = await openProjectChange(worktreeId, 'source', {
        id: `file:${name}`,
        kind: 'create-file'
      })
      const next = await prepareSourceProposal(record, name, content)
      retainProposalDraft(worktreeId, name, content)
      onPrepared(next)
      setOpen(false)
    })()
      .catch((failure: unknown) =>
        setError(failure instanceof Error ? failure.message : String(failure))
      )
      .finally(() => setBusy(false))
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline">{translate('changes.newFile', 'New file change')}</Button>
      </DialogTrigger>
      <DialogContent scrollable>
        <DialogHeader>
          <DialogTitle>{translate('changes.newFile', 'New file change')}</DialogTitle>
          <DialogDescription>
            {translate(
              'changes.newFileDescription',
              'Prepare a new source file in this project. Review and file creation are separate actions; existing files are never replaced.'
            )}
          </DialogDescription>
        </DialogHeader>
        <label htmlFor="proposal-new-name">
          {translate('changes.filename', 'Filename at project root')}
        </label>
        <Input
          id="proposal-new-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          disabled={busy}
        />
        <label htmlFor="proposal-new-content">
          {translate('changes.proposedContent', 'Proposed source')}
        </label>
        <Textarea
          id="proposal-new-content"
          variant="code"
          value={content}
          onChange={(event) => setContent(event.target.value)}
          disabled={busy}
        />
        {error && (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )}
        <Button disabled={busy} onClick={prepare}>
          {busy
            ? translate('changes.preparingProposal', 'Preparing proposal…')
            : translate('changes.prepareProposal', 'Prepare file proposal')}
        </Button>
      </DialogContent>
    </Dialog>
  )
}
