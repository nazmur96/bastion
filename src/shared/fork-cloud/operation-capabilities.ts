/**
 * Fork: one policy description for every cloud operation the app can perform. The UI labels,
 * the IPC handlers and (later) agent tools and remote dispatch all read the same entry, so no
 * path can offer an operation with weaker consent than another.
 */
export type OperationEffect =
  /** Reads Bastion's own metadata on this machine. */
  | 'local-read'
  /** Changes Bastion's own metadata (targets, selections, anchors); no provider call. */
  | 'local-write'
  /** Starts, stops or resets a private local emulator. */
  | 'local-lifecycle'
  /** Hands a sealed environment to a terminal or step run. */
  | 'environment'
  /** Reads non-sensitive provider metadata. */
  | 'metadata-read'
  /** A provider read the provider may bill. */
  | 'paid-read'
  /** Creates new files in the project; never overwrites. */
  | 'source-write'
  /** Formats, initializes and validates project source in a private copy. */
  | 'validation'
  /** Creates or destroys resources in a local emulator only. */
  | 'emulated-write'
  /** Reads data that may hold secrets (workload logs); bounded and redacted. */
  | 'sensitive-read'
  /** Sends one read-only request to the deployed application. */
  | 'journey-check'
  /** Creates, changes or deletes real cloud resources; may incur charges. */
  | 'provider-write'
export type OperationConsent =
  | 'none'
  /** A target-specific confirmation in the app. */
  | 'confirmation'
  /** The target's identity must be verified and accepted first. */
  | 'identity-anchor'
  /** A main-held, single-use, short-lived grant from a confirmation. */
  | 'one-use-grant'
export type OperationCapability = {
  label: string
  /** Every operation runs on the project's owner, never with another host's credentials. */
  runsOn: 'owner'
  target: 'none' | 'selected-emulated' | 'selected-real'
  effect: OperationEffect
  /** Where data leaves the owner: nowhere, the loopback emulator, or the cloud provider. */
  egress:
    | 'none'
    | 'loopback'
    | 'provider'
    | 'registry'
    | 'cluster'
    | 'delivery-sources'
    | 'endpoints'
    | 'monitoring'
  consent: OperationConsent
}

import { OPERATIONS_CAPABILITIES } from './operations-capabilities'

export const OPERATION_CAPABILITIES = {
  'targets.read': {
    label: 'Read cloud targets',
    runsOn: 'owner',
    target: 'none',
    effect: 'local-read',
    egress: 'none',
    consent: 'none'
  },
  'targets.update': {
    label: 'Change cloud targets',
    runsOn: 'owner',
    target: 'none',
    effect: 'local-write',
    egress: 'none',
    consent: 'none'
  },
  'targets.capture-binding': {
    label: 'Record the selected target for a review',
    runsOn: 'owner',
    target: 'selected-emulated',
    effect: 'local-read',
    egress: 'none',
    consent: 'none'
  },
  'floci.runtime': {
    label: 'Read emulator status',
    runsOn: 'owner',
    target: 'selected-emulated',
    effect: 'metadata-read',
    egress: 'loopback',
    consent: 'none'
  },
  'floci.start': {
    label: 'Start the local emulator',
    runsOn: 'owner',
    target: 'selected-emulated',
    effect: 'local-lifecycle',
    egress: 'none',
    consent: 'none'
  },
  'floci.stop': {
    label: 'Stop the local emulator',
    runsOn: 'owner',
    target: 'selected-emulated',
    effect: 'local-lifecycle',
    egress: 'none',
    consent: 'none'
  },
  'floci.reset': {
    label: 'Reset the local emulator data',
    runsOn: 'owner',
    target: 'selected-emulated',
    effect: 'local-lifecycle',
    egress: 'none',
    consent: 'confirmation'
  },
  'floci.resources': {
    label: 'List emulator resources',
    runsOn: 'owner',
    target: 'selected-emulated',
    effect: 'metadata-read',
    egress: 'loopback',
    consent: 'none'
  },
  'floci.environment': {
    label: 'Open a terminal for the emulator',
    runsOn: 'owner',
    target: 'selected-emulated',
    effect: 'environment',
    egress: 'loopback',
    consent: 'none'
  },
  'aws.verify': {
    label: 'Verify the real AWS identity',
    runsOn: 'owner',
    target: 'selected-real',
    effect: 'metadata-read',
    egress: 'provider',
    consent: 'none'
  },
  'aws.accept-identity': {
    label: 'Accept the observed AWS identity',
    runsOn: 'owner',
    target: 'selected-real',
    effect: 'local-write',
    egress: 'provider',
    consent: 'confirmation'
  },
  'aws.resources': {
    label: 'Read AWS resources',
    runsOn: 'owner',
    target: 'selected-real',
    effect: 'metadata-read',
    egress: 'provider',
    consent: 'identity-anchor'
  },
  'aws.budgets': {
    label: 'Read AWS budget alerts',
    runsOn: 'owner',
    target: 'selected-real',
    effect: 'metadata-read',
    egress: 'provider',
    consent: 'identity-anchor'
  },
  'aws.cost.prepare': {
    label: 'Prepare a Cost Explorer read',
    runsOn: 'owner',
    target: 'selected-real',
    effect: 'metadata-read',
    egress: 'provider',
    consent: 'identity-anchor'
  },
  'aws.cost.confirm': {
    label: 'Confirm a Cost Explorer read',
    runsOn: 'owner',
    target: 'selected-real',
    effect: 'local-write',
    egress: 'none',
    consent: 'confirmation'
  },
  'aws.cost.read': {
    label: 'Read Cost Explorer data',
    runsOn: 'owner',
    target: 'selected-real',
    effect: 'paid-read',
    egress: 'provider',
    consent: 'one-use-grant'
  },
  'recipes.create': {
    label: 'Create recipe files',
    runsOn: 'owner',
    target: 'none',
    effect: 'source-write',
    egress: 'none',
    consent: 'confirmation'
  },
  'recipes.read': {
    label: 'Read recipe files',
    runsOn: 'owner',
    target: 'none',
    effect: 'local-read',
    egress: 'none',
    consent: 'none'
  },
  'recipes.validate': {
    label: 'Validate recipe source',
    runsOn: 'owner',
    target: 'none',
    effect: 'validation',
    egress: 'registry',
    consent: 'none'
  },
  'recipes.apply-emulated': {
    label: 'Apply recipe to the local emulator',
    runsOn: 'owner',
    target: 'selected-emulated',
    effect: 'emulated-write',
    egress: 'loopback',
    consent: 'confirmation'
  },
  'recipes.destroy-emulated': {
    label: 'Destroy recipe resources in the local emulator',
    runsOn: 'owner',
    target: 'selected-emulated',
    effect: 'emulated-write',
    egress: 'loopback',
    consent: 'confirmation'
  },
  ...OPERATIONS_CAPABILITIES,
  'aws.cost.cached': {
    label: 'Show cached Cost Explorer data',
    runsOn: 'owner',
    target: 'selected-real',
    effect: 'local-read',
    egress: 'none',
    consent: 'none'
  }
} as const satisfies Record<string, OperationCapability>
export type OperationId = keyof typeof OPERATION_CAPABILITIES

/** Each IPC channel and the operations it may perform; anything else is refused. */
export const CHANNEL_OPERATIONS = {
  'bastionCloud:read': ['targets.read'],
  'bastionCloud:update': ['targets.update'],
  'bastionCloud:captureBinding': ['targets.capture-binding'],
  'bastionCloud:readRuntime': ['floci.runtime'],
  'bastionCloud:runLifecycle': ['floci.start', 'floci.stop', 'floci.reset'],
  'bastionCloud:listResources': ['floci.resources'],
  'bastionCloud:targetEnv': ['floci.environment'],
  'bastionCloud:verifyRealTarget': ['aws.verify'],
  'bastionCloud:acceptRealIdentity': ['aws.accept-identity'],
  'bastionCloud:readRealTarget': ['aws.resources', 'aws.budgets', 'aws.backups'],
  'bastionCloud:prepareRealCost': ['aws.cost.prepare'],
  'bastionCloud:confirmRealCost': ['aws.cost.confirm'],
  'bastionCloud:readRealCost': ['aws.cost.read'],
  'bastionCloud:cachedRealCost': ['aws.cost.cached'],
  'bastionCloud:recipeCreate': ['recipes.create'],
  'bastionCloud:deliveryChain': ['delivery.evidence'],
  'bastionCloud:deliveryPromote': ['delivery.promote'],
  'bastionCloud:operationsDiagnose': ['operations.diagnose', 'operations.logs'],
  'bastionCloud:operationsVerify': ['operations.verify'],
  'bastionCloud:operationsRuns': ['operations.runs'],
  'bastionCloud:operationsCertificates': ['operations.certificates'],
  'bastionCloud:operationsBackups': ['operations.backups'],
  'bastionCloud:operationsMonitoring': ['operations.monitoring'],
  'bastionCloud:runbookList': ['runbooks.read'],
  'bastionCloud:runbookCreate': ['runbooks.create'],
  'bastionCloud:recipeRealPrepare': ['recipes.prepare-real'],
  'bastionCloud:recipeRealDeliver': ['recipes.apply-real', 'recipes.destroy-real'],
  'bastionCloud:recipeRead': ['recipes.read'],
  'bastionCloud:recipeValidate': ['recipes.validate'],
  'bastionCloud:recipeDeliver': ['recipes.apply-emulated', 'recipes.destroy-emulated']
} as const satisfies Record<string, readonly OperationId[]>

export function isOperationId(value: string): value is OperationId {
  return Object.hasOwn(OPERATION_CAPABILITIES, value)
}

/** A short, consistent note for buttons and tooltips. */
export function capabilityNote(id: OperationId): string {
  const capability: OperationCapability = OPERATION_CAPABILITIES[id]
  const where =
    capability.egress === 'provider'
      ? 'AWS'
      : capability.egress === 'loopback'
        ? 'local emulator'
        : capability.egress === 'registry'
          ? 'provider registry'
          : capability.egress === 'cluster'
            ? 'Kubernetes cluster'
            : capability.egress === 'delivery-sources'
              ? 'GitHub, registry and cluster'
              : capability.egress === 'endpoints'
                ? "the app's endpoints and cluster"
                : capability.egress === 'monitoring'
                  ? "the project's Prometheus and Grafana"
                  : 'this computer'
  const effect: Record<OperationEffect, string> = {
    'local-read': 'Reads Bastion data',
    'local-write': 'Changes Bastion data only',
    'local-lifecycle': 'Local emulator · no charges',
    environment: 'Sealed environment · no real credentials',
    'metadata-read': 'Free read',
    'paid-read': 'Paid read · AWS may charge per request',
    'source-write': 'Creates new project files · never overwrites',
    validation: 'Validates in a private copy · downloads pinned providers',
    'emulated-write': 'Changes local emulator resources · no charges',
    'sensitive-read': 'Sensitive read · bounded and redacted',
    'journey-check': 'One read-only request to the app',
    'provider-write': 'Changes real cloud resources · may incur charges'
  }
  const consent: Record<OperationConsent, string | null> = {
    none: null,
    confirmation: 'asks for confirmation',
    'identity-anchor': 'needs a verified identity',
    'one-use-grant': 'needs a one-use confirmation'
  }
  return [effect[capability.effect], where, consent[capability.consent]].filter(Boolean).join(' · ')
}

/**
 * Admits one operation on one channel. A channel can only perform the operations listed for it,
 * so a new operation cannot ride an existing handler without a policy entry.
 */
export function admitChannelOperation(
  channel: keyof typeof CHANNEL_OPERATIONS,
  id: OperationId
): OperationCapability {
  const allowed: readonly OperationId[] = CHANNEL_OPERATIONS[channel]
  if (!allowed.includes(id)) {
    throw new Error(`Operation ${id} is not admitted on ${channel}.`)
  }
  return OPERATION_CAPABILITIES[id]
}
