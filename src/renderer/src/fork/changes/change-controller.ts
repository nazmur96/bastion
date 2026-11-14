import {
  currentChangeReview,
  sameChangeSnapshot,
  type ChangeEntrance,
  type ChangeIntent,
  type ChangeSnapshot,
  type ChangeRecord
} from '../../../../shared/fork-changes/change-contract'
import { captureSourceCheckOwner } from './source-check-owner'
import { executeReviewedOwnerRun, pinOwnerSnapshot } from './owner-execution-client'

import { changesApi, updateChange } from './change-channel'
export { subscribeChangeProgress } from './change-channel'
export async function openProjectChange(
  projectId: string,
  entrance: ChangeEntrance,
  intent?: ChangeIntent
): Promise<ChangeRecord> {
  const owner = captureSourceCheckOwner(projectId)
  const record = await changesApi().ensure({
    scope: owner.scope,
    entrance,
    ...(intent ? { intent } : {})
  })
  owner.assertCurrent()
  return record
}

export function matchingOwner(record: ChangeRecord) {
  const owner = captureSourceCheckOwner(record.scope.projectId)
  if (JSON.stringify(owner.scope) !== JSON.stringify(record.scope)) {
    throw new Error('Change owner or target changed. Reopen Changes & runs.')
  }
  return owner
}

async function bindSnapshot(
  record: ChangeRecord,
  snapshot: ChangeSnapshot
): Promise<ChangeSnapshot> {
  if (record.intent?.targetMode !== 'selected-cloud') {
    return { ...snapshot, cloudBinding: { kind: 'none' } }
  }
  const capture = window.api.cloudTargets?.captureBinding
  if (!capture) {
    throw new Error('This client cannot prepare cloud-bound changes.')
  }
  return { ...snapshot, cloudBinding: await capture(record.scope.projectId) }
}

export async function prepareSourceChange(
  record: ChangeRecord,
  paths: string[]
): Promise<ChangeRecord> {
  const owner = matchingOwner(record)
  const snapshot = await pinOwnerSnapshot(owner, await owner.snapshot(paths))
  return updateChange(record, { kind: 'validate', snapshot: await bindSnapshot(record, snapshot) })
}

export async function reviewSourceChange(record: ChangeRecord): Promise<ChangeRecord> {
  const validation = record.validations.at(-1)
  if (!validation) {
    throw new Error('Prepare source before reviewing it.')
  }
  const owner = matchingOwner(record)
  const snapshot = await bindSnapshot(
    record,
    await pinOwnerSnapshot(
      owner,
      await owner.snapshot(validation.snapshot.files.map((file) => file.path))
    )
  )
  if (!sameChangeSnapshot(snapshot, validation.snapshot)) {
    await updateChange(record, { kind: 'validate', snapshot })
    throw new Error(
      snapshot.ownerRuntimeId !== validation.snapshot.ownerRuntimeId
        ? 'Execution owner changed. Prepare and review the current configuration.'
        : 'Source changed. Prepare the saved files again before review.'
    )
  }
  return updateChange(record, { kind: 'review', validationId: validation.id, snapshot })
}

export async function runSourceChange(
  record: ChangeRecord,
  progress: (record: ChangeRecord) => void
): Promise<ChangeRecord> {
  const review = currentChangeReview(record)
  if (!review) {
    throw new Error('Review the prepared source before running checks.')
  }
  const owner = matchingOwner(record)
  const snapshot = await bindSnapshot(
    record,
    await pinOwnerSnapshot(
      owner,
      await owner.snapshot(review.snapshot.files.map((file) => file.path))
    )
  )
  if (!sameChangeSnapshot(snapshot, review.snapshot)) {
    await updateChange(record, { kind: 'validate', snapshot })
    throw new Error(
      snapshot.ownerRuntimeId !== review.snapshot.ownerRuntimeId
        ? 'Execution owner changed. Prepare and review the current configuration.'
        : 'Source changed. Prepare and review the saved files again.'
    )
  }
  const current = await executeReviewedOwnerRun(record, owner, snapshot)
  progress(current)
  return current
}
