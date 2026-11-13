import {
  currentChangeReview,
  sameChangeSnapshot,
  type ChangeCommand,
  type ChangeEntrance,
  type ChangeRecord
} from '../../../../shared/fork-changes/change-contract'
import { captureSourceCheckOwner, checkSourceText } from './source-check-owner'

const listeners = new Set<(record: ChangeRecord) => void>()
export function subscribeChangeProgress(listener: (record: ChangeRecord) => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function changesApi() {
  if (!window.api.changes) {
    throw new Error('Change records require the desktop application.')
  }
  return window.api.changes
}

export async function openProjectChange(
  projectId: string,
  entrance: ChangeEntrance
): Promise<ChangeRecord> {
  const owner = captureSourceCheckOwner(projectId)
  const record = await changesApi().ensure({ scope: owner.scope, entrance })
  owner.assertCurrent()
  return record
}

function matchingOwner(record: ChangeRecord) {
  const owner = captureSourceCheckOwner(record.scope.projectId)
  if (JSON.stringify(owner.scope) !== JSON.stringify(record.scope)) {
    throw new Error('Change owner or target changed. Reopen Changes & runs.')
  }
  return owner
}

export async function updateChange(
  record: ChangeRecord,
  command: ChangeCommand
): Promise<ChangeRecord> {
  const next = await changesApi().command({ id: record.id, revision: record.revision, command })
  for (const listener of listeners) {
    listener(next)
  }
  return next
}

export async function prepareSourceChange(
  record: ChangeRecord,
  paths: string[]
): Promise<ChangeRecord> {
  const owner = matchingOwner(record)
  const snapshot = await owner.snapshot(paths)
  return updateChange(record, { kind: 'validate', snapshot })
}

export async function reviewSourceChange(record: ChangeRecord): Promise<ChangeRecord> {
  const validation = record.validations.at(-1)
  if (!validation) {
    throw new Error('Prepare source before reviewing it.')
  }
  const snapshot = await matchingOwner(record).snapshot(
    validation.snapshot.files.map((file) => file.path)
  )
  if (!sameChangeSnapshot(snapshot, validation.snapshot)) {
    await updateChange(record, { kind: 'validate', snapshot })
    throw new Error('Source changed. Prepare the saved files again before review.')
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
  const snapshot = await owner.snapshot(review.snapshot.files.map((file) => file.path))
  if (!sameChangeSnapshot(snapshot, review.snapshot)) {
    await updateChange(record, { kind: 'validate', snapshot })
    throw new Error('Source changed. Prepare and review the saved files again.')
  }
  let current = await updateChange(record, { kind: 'start', reviewId: review.id, snapshot })
  const run = current.runs.at(-1)
  if (!run) {
    throw new Error('Source check did not start.')
  }
  progress(current)
  for (const file of snapshot.files) {
    let code: ReturnType<typeof checkSourceText> = 'unavailable'
    try {
      code = checkSourceText(file.path, await owner.read(file.path), file.fingerprint)
    } catch {
      code = 'unavailable'
    }
    current = await updateChange(current, { kind: 'step', runId: run.id, path: file.path, code })
    progress(current)
    if (code !== 'readable' && code !== 'json-valid') {
      break
    }
  }
  current = await updateChange(current, { kind: 'finish', runId: run.id })
  progress(current)
  let verification: 'unchanged' | 'changed' | 'unavailable' = 'unavailable'
  try {
    verification = sameChangeSnapshot(
      snapshot,
      await owner.snapshot(snapshot.files.map((file) => file.path))
    )
      ? 'unchanged'
      : 'changed'
  } catch {
    verification = 'unavailable'
  }
  current = await updateChange(current, { kind: 'verify', runId: run.id, code: verification })
  progress(current)
  return current
}
