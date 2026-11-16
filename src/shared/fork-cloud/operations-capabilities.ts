import type { OperationCapability } from './operation-capabilities'

/** Fork: Step 12 verification, diagnosis and runbook operations; part of the one policy registry. */
export const OPERATIONS_CAPABILITIES = {
  'operations.diagnose': {
    label: 'Diagnose the deployed workload',
    runsOn: 'owner',
    target: 'none',
    effect: 'metadata-read',
    egress: 'cluster',
    consent: 'none'
  },
  'operations.logs': {
    label: 'Read workload logs',
    runsOn: 'owner',
    target: 'none',
    effect: 'sensitive-read',
    egress: 'cluster',
    consent: 'none'
  },
  'operations.verify': {
    label: 'Run a journey check',
    runsOn: 'owner',
    target: 'none',
    effect: 'journey-check',
    egress: 'cluster',
    consent: 'none'
  },
  'operations.runs': {
    label: 'Read verification runs',
    runsOn: 'owner',
    target: 'none',
    effect: 'local-read',
    egress: 'none',
    consent: 'none'
  },
  'runbooks.read': {
    label: 'List runbooks',
    runsOn: 'owner',
    target: 'none',
    effect: 'local-read',
    egress: 'none',
    consent: 'none'
  },
  'runbooks.create': {
    label: 'Create a runbook',
    runsOn: 'owner',
    target: 'none',
    effect: 'source-write',
    egress: 'none',
    consent: 'confirmation'
  }
} as const satisfies Record<string, OperationCapability>
