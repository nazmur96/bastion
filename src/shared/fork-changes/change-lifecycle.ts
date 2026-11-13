import {
  currentChangeReview,
  sameChangeSnapshot,
  sameChangeScope,
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
  if (command.kind === 'invalidate') {
    next.invalidated = true
  } else if (command.kind === 'reconcile') {
    const receipt = command.receipt
    const run = next.runs.find((item) => item.id === receipt.id)
    if (
      !run?.execution ||
      run.execution.runtimeId !== receipt.runtimeId ||
      (run.scope ?? next.scope).root !== receipt.root ||
      !sameChangeSnapshot(run.snapshot, receipt.snapshot)
    ) {
      throw new Error('Owner receipt does not match the pinned run.')
    }
    if (
      run.steps.some(
        (step, index) => JSON.stringify(step) !== JSON.stringify(receipt.steps[index])
      ) ||
      (run.status !== 'running' && run.status !== 'interrupted' && run.status !== receipt.status) ||
      (run.status === 'interrupted' && receipt.status === 'running') ||
      (run.verification &&
        JSON.stringify(run.verification) !== JSON.stringify(receipt.verification))
    ) {
      throw new Error('Owner receipt would replace settled execution evidence.')
    }
    run.steps = receipt.steps
    run.status = receipt.status
    run.finishedAt = receipt.finishedAt
    run.verification = receipt.verification
  } else if (command.kind === 'interrupt') {
    const run = next.runs.find((item) => item.id === command.runId)
    if (!run?.execution || run.status !== 'running') {
      throw new Error('No unfinished owner run to interrupt.')
    }
    run.status = 'interrupted'
    run.finishedAt = at
  } else if (command.kind === 'validate') {
    if (running) {
      throw new Error('Wait for the active source check to finish.')
    }
    if ((next.intent?.kind === 'create-file') !== (command.snapshot.adapter === 'create-file/v1')) {
      throw new Error('Adapter does not match this change intent.')
    }
    next.invalidated = false
    next.validations.push({ id, at, snapshot: command.snapshot, scope: next.scope })
  } else if (command.kind === 'review') {
    const validation = next.validations.at(-1)
    if (
      running ||
      validation?.id !== command.validationId ||
      !sameChangeScope(validation.scope ?? next.scope, next.scope) ||
      !sameChangeSnapshot(validation.snapshot, command.snapshot)
    ) {
      throw new Error('The prepared source changed. Prepare and review it again.')
    }
    next.reviews.push({
      id,
      at,
      validationId: validation.id,
      snapshot: command.snapshot,
      scope: next.scope
    })
  } else if (command.kind === 'start') {
    const review = currentChangeReview(next)
    if (
      running ||
      review?.id !== command.reviewId ||
      (command.execution && command.snapshot.ownerRuntimeId !== command.execution.runtimeId) ||
      !sameChangeSnapshot(review.snapshot, command.snapshot)
    ) {
      throw new Error('The review is stale. Prepare and review the current source.')
    }
    next.runs.push({
      id,
      at,
      reviewId: review.id,
      snapshot: review.snapshot,
      scope: next.scope,
      ...(command.execution ? { execution: command.execution } : {}),
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
    if (run.execution) {
      throw new Error('Owner runs accept only owner receipts, not renderer-produced results.')
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
        run.steps.every(
          (step) =>
            step.code === 'readable' || step.code === 'json-valid' || step.code === 'created'
        )
          ? 'passed'
          : 'failed'
      run.finishedAt = at
    }
  }
  next.revision++
  return next
}
