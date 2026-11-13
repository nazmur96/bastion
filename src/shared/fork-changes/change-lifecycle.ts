import {
  currentChangeReview,
  sameChangeSnapshot,
  type ChangeCommand,
  type ChangeRecord
} from './change-contract'

export function applyChangeCommand(
  record: ChangeRecord,
  command: ChangeCommand,
  id: string,
  at: number
): ChangeRecord {
  const next = structuredClone(record)
  if (
    (command.kind === 'validate' || command.kind === 'review' || command.kind === 'start') &&
    record.validations.length + record.reviews.length + record.runs.length >= 1000
  ) {
    throw new Error('This change reached its history limit. Its evidence is preserved.')
  }
  const running = next.runs.find((run) => run.status === 'running')
  if (command.kind === 'validate') {
    if (running) {
      throw new Error('Wait for the active source check to finish.')
    }
    next.validations.push({ id, at, snapshot: command.snapshot })
  } else if (command.kind === 'review') {
    const validation = next.validations.at(-1)
    if (
      running ||
      validation?.id !== command.validationId ||
      !sameChangeSnapshot(validation.snapshot, command.snapshot)
    ) {
      throw new Error('The prepared source changed. Prepare and review it again.')
    }
    next.reviews.push({ id, at, validationId: validation.id, snapshot: command.snapshot })
  } else if (command.kind === 'start') {
    const review = currentChangeReview(next)
    if (
      running ||
      review?.id !== command.reviewId ||
      !sameChangeSnapshot(review.snapshot, command.snapshot)
    ) {
      throw new Error('The review is stale. Prepare and review the current source.')
    }
    next.runs.push({
      id,
      at,
      reviewId: review.id,
      snapshot: review.snapshot,
      steps: [],
      status: 'running',
      finishedAt: null,
      verification: null
    })
  } else {
    const run = next.runs.find((candidate) => candidate.id === command.runId)
    if (!run) {
      throw new Error('Source-check run not found.')
    }
    if (command.kind === 'verify') {
      if (run.status === 'running' || run.verification) {
        throw new Error('Verification requires a finished, unverified run.')
      }
      run.verification = { at, code: command.code }
    } else if (run.status !== 'running') {
      throw new Error('This run is finished. Start a new attempt to retry.')
    } else if (command.kind === 'step') {
      const expected = run.snapshot.files[run.steps.length]
      if (expected?.path !== command.path) {
        throw new Error('Source-check result does not match the pinned plan.')
      }
      run.steps.push({ path: command.path, code: command.code, at })
    } else {
      run.status =
        run.steps.length === run.snapshot.files.length &&
        run.steps.every((step) => step.code === 'readable' || step.code === 'json-valid')
          ? 'passed'
          : 'failed'
      run.finishedAt = at
    }
  }
  next.revision++
  return next
}
