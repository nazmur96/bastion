import { readRuntimeDirectory } from '@/runtime/runtime-file-mutation-client'
import { getDiskBaselineSignature } from '../../../../shared/disk-baseline-signature'
import {
  currentChangeReview,
  sameChangeSnapshot,
  type ChangeRecord,
  type ChangeSnapshot
} from '../../../../shared/fork-changes/change-contract'
import { isRootSourceFilename } from '../../../../shared/fork-changes/owner-run-contract'
import { matchingOwner } from './change-controller'
import { updateChange } from './change-channel'
import { executeReviewedOwnerRun, pinOwnerSnapshot } from './owner-execution-client'

export function proposalSnapshot(name: string, content: string): ChangeSnapshot {
  if (!isRootSourceFilename(name) || name.length > 120) {
    throw new Error(
      'Choose a supported source filename at the project root (up to 120 characters).'
    )
  }
  if (
    new TextEncoder().encode(content).length > 65536 ||
    new TextDecoder().decode(new TextEncoder().encode(content)) !== content
  ) {
    throw new Error('Proposal must be valid UTF-8 of at most 64 KiB.')
  }
  if (name.endsWith('.json')) {
    try {
      JSON.parse(content)
    } catch {
      throw new Error('The proposed JSON is invalid. Correct it before preparing the file.')
    }
  }
  return {
    adapter: 'create-file/v1',
    files: [{ path: name, fingerprint: getDiskBaselineSignature(content) }]
  }
}
async function requireAbsent(record: ChangeRecord, name: string) {
  const owner = matchingOwner(record)
  const entries = await readRuntimeDirectory(owner.context, owner.scope.root)
  owner.assertCurrent()
  if (entries.some((entry) => entry.name === name)) {
    await updateChange(record, { kind: 'invalidate' })
    throw new Error(
      'The destination already exists. Open it in the editor; this proposal will not replace it.'
    )
  }
  return owner
}
export async function prepareSourceProposal(
  record: ChangeRecord,
  name: string,
  content: string
): Promise<ChangeRecord> {
  const snapshot = proposalSnapshot(name, content)
  if (record.intent?.kind !== 'create-file' || record.intent.id !== `file:${name}`) {
    throw new Error('Select the matching file-creation change before preparing it.')
  }
  const owner = await requireAbsent(record, name)
  return updateChange(record, {
    kind: 'validate',
    snapshot: await pinOwnerSnapshot(owner, snapshot)
  })
}
export async function reviewSourceProposal(
  record: ChangeRecord,
  name: string,
  content: string
): Promise<ChangeRecord> {
  const owner = await requireAbsent(record, name)
  const snapshot = await pinOwnerSnapshot(owner, proposalSnapshot(name, content))
  const validation = record.validations.at(-1)
  if (!validation || !sameChangeSnapshot(snapshot, validation.snapshot)) {
    await updateChange(record, { kind: 'invalidate' })
    throw new Error('Proposal changed. Prepare it again before review.')
  }
  return updateChange(record, { kind: 'review', validationId: validation.id, snapshot })
}
export async function createSourceProposal(
  record: ChangeRecord,
  name: string,
  content: string
): Promise<ChangeRecord> {
  const owner = await requireAbsent(record, name)
  const snapshot = await pinOwnerSnapshot(owner, proposalSnapshot(name, content))
  const review = currentChangeReview(record)
  if (!review || !sameChangeSnapshot(snapshot, review.snapshot)) {
    await updateChange(record, { kind: 'invalidate' })
    throw new Error('Proposal changed. Prepare and review it again before file creation.')
  }
  return executeReviewedOwnerRun(record, owner, snapshot, content)
}
