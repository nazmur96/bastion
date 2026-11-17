import type { JourneyCheck, VerificationRun, WorkloadDiagnosis } from './operations-contract'

const short = (value: string | null) =>
  value ? (value.startsWith('sha256:') ? `${value.slice(0, 19)}…` : value.slice(0, 12)) : 'unknown'

/** A slug for the runbook's file name. */
export function runbookName(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'runbook'
  )
}

/**
 * A prefilled draft from observed evidence only. Cause, correction and recovery are left for
 * the engineer to write: a draft never claims a cause the evidence does not show.
 */
export function runbookDraft(input: {
  title: string
  application: string
  diagnosis: WorkloadDiagnosis
  check: JourneyCheck | null
  runs: VerificationRun[]
}): string {
  const { diagnosis } = input
  const failing = diagnosis.containers.filter((item) => !item.ready)
  const lines = [
    `# ${input.title}`,
    '',
    `Application: ${input.application} · namespace ${diagnosis.namespace ?? 'unknown'}`,
    `Observed: ${new Date(diagnosis.readAt).toISOString()}`,
    '',
    '## Symptom',
    '',
    ...diagnosis.rollouts.map(
      (rollout) =>
        `- Rollout ${rollout.name}: ${rollout.status}, ${rollout.updated}/${rollout.desired} updated, ${rollout.available} available, ${rollout.total} ${rollout.total === 1 ? 'pod' : 'pods'}`
    ),
    ...failing.map(
      (item) =>
        `- ${item.pod}/${item.container}: ${item.state}, ${item.restarts} restarts${item.lastExit ? `, last exit ${item.lastExit.code} (${item.lastExit.reason})` : ''}`
    ),
    '',
    '## Evidence',
    '',
    ...failing.map(
      (item) =>
        `- Image ${short(item.digest)} → revision ${short(item.revision)} (${item.revisionSource})`
    ),
    ...diagnosis.events
      .slice(0, 5)
      .map(
        (event) => `- Event ${event.reason} on ${event.object} ×${event.count}: ${event.message}`
      ),
    ...diagnosis.logs
      .filter((log) => log.previous)
      .slice(0, 1)
      .flatMap((log) => [
        '',
        `Previous log of ${log.pod}/${log.container} (last lines, redacted):`,
        '',
        '```text',
        ...log.text.split('\n').slice(-8),
        '```'
      ]),
    ...(diagnosis.unknown.length
      ? ['', 'Not readable:', ...diagnosis.unknown.map((item) => `- ${item}`)]
      : []),
    '',
    '## Cause',
    '',
    '_Write the cause the evidence above supports._',
    '',
    '## Recovery',
    '',
    '1. On the Delivery page, read the evidence for the last verified revision.',
    '2. Pin its digest (rollback), then commit and push the change; the controller deploys it.',
    '3. Run the journey check below and record the result as a drill.',
    '',
    'Limits: rollback does not undo data or schema changes or external side effects.',
    '',
    '## Correction',
    '',
    '_The source change that fixes the cause, and the revision that carries it._',
    '',
    '## Verification',
    '',
    input.check
      ? `Journey check: GET ${input.check.service}:${input.check.port}${input.check.path} through the cluster API, expecting "${input.check.expect}".`
      : 'Journey check: not configured yet.',
    ...input.runs
      .slice(0, 5)
      .map(
        (run) =>
          `- ${new Date(run.at).toISOString()} ${run.kind} ${run.passed ? 'passed' : 'failed'} · revision ${short(run.revision)} · ${run.detail}`
      )
  ]
  return `${lines.join('\n')}\n`
}
