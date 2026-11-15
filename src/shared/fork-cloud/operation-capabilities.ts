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
  egress: 'none' | 'loopback' | 'provider'
  consent: OperationConsent
}

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
    effect: 'local-read',
    egress: 'none',
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
    egress: 'none',
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
  'bastionCloud:readRealTarget': ['aws.resources', 'aws.budgets'],
  'bastionCloud:prepareRealCost': ['aws.cost.prepare'],
  'bastionCloud:confirmRealCost': ['aws.cost.confirm'],
  'bastionCloud:readRealCost': ['aws.cost.read'],
  'bastionCloud:cachedRealCost': ['aws.cost.cached']
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
        : 'this computer'
  const effect: Record<OperationEffect, string> = {
    'local-read': 'Reads Bastion data',
    'local-write': 'Changes Bastion data only',
    'local-lifecycle': 'Local emulator · no charges',
    environment: 'Sealed environment · no real credentials',
    'metadata-read': 'Free read',
    'paid-read': 'Paid read · AWS may charge per request'
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
