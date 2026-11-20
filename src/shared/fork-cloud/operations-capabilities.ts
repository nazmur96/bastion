import type { OperationCapability } from './operation-capabilities'

/** Fork: Step 11–14 delivery, operations, runbook and real-recipe entries of the one policy registry. */
export const OPERATIONS_CAPABILITIES = {
  'delivery.evidence': {
    label: 'Read delivery evidence',
    runsOn: 'owner',
    target: 'none',
    effect: 'metadata-read',
    egress: 'delivery-sources',
    consent: 'none'
  },
  'delivery.promote': {
    label: 'Pin a verified image digest in the deployment config',
    runsOn: 'owner',
    target: 'none',
    effect: 'source-write',
    egress: 'none',
    consent: 'confirmation'
  },
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
  'operations.certificates': {
    label: 'Read certificate expiry',
    runsOn: 'owner',
    target: 'none',
    effect: 'metadata-read',
    egress: 'endpoints',
    consent: 'none'
  },
  'aws.backups': {
    label: 'Read RDS backup evidence',
    runsOn: 'owner',
    target: 'selected-real',
    effect: 'metadata-read',
    egress: 'provider',
    consent: 'identity-anchor'
  },
  'operations.backups': {
    label: 'Read backup evidence',
    runsOn: 'owner',
    target: 'none',
    effect: 'metadata-read',
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
  'recipes.prepare-real': {
    label: 'Prepare a recipe change on real AWS',
    runsOn: 'owner',
    target: 'selected-real',
    effect: 'metadata-read',
    egress: 'provider',
    consent: 'identity-anchor'
  },
  'recipes.apply-real': {
    label: 'Apply a reviewed recipe to real AWS',
    runsOn: 'owner',
    target: 'selected-real',
    effect: 'provider-write',
    egress: 'provider',
    consent: 'one-use-grant'
  },
  'recipes.destroy-real': {
    label: 'Destroy a reviewed recipe from real AWS',
    runsOn: 'owner',
    target: 'selected-real',
    effect: 'provider-write',
    egress: 'provider',
    consent: 'one-use-grant'
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
