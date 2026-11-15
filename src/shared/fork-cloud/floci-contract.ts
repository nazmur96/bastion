import { z } from 'zod'
export const FLOCI_IMAGE =
  'floci/floci@sha256:5ee85db604c4aa74ac76e07ea5cc83086f37bb472bf3dbb97e34019e48efae9c'
export const flociOperationSchema = z.enum(['start', 'stop', 'reset'])
export const flociCodes = z.enum([
  'complete',
  'unsupported',
  'interrupted',
  'engine-unavailable',
  'container-policy-missing',
  'access-denied',
  'image-unavailable',
  'port-conflict',
  'instance-conflict',
  'not-ready',
  'owner-changed',
  'busy',
  'confirmation-required',
  'invalid',
  'storage'
])
export type FlociCode = z.infer<typeof flociCodes>
export const flociMessages: Record<FlociCode, string> = {
  complete: 'Operation completed.',
  unsupported: 'The selected emulator does not support this operation.',
  interrupted: 'Operation interrupted; refresh to inspect the instance.',
  'engine-unavailable':
    'The selected local container engine is unavailable. Configure Docker or rootless Podman on the owner.',
  'container-policy-missing':
    'Podman cannot pull this image without its container image policy. Configure that policy yourself or explicitly choose another configured engine.',
  'access-denied':
    'The selected engine socket is not accessible. No privilege escalation was attempted.',
  'image-unavailable': 'The pinned emulator image is unavailable for this engine or platform.',
  'port-conflict': 'The reserved loopback port is occupied. No other process was stopped.',
  'instance-conflict':
    'The container does not match this workspace instance. It was left unchanged.',
  'not-ready': 'The emulator has not passed its readiness check.',
  'owner-changed': 'The project execution owner changed.',
  busy: 'An operation on this target is still active.',
  'confirmation-required': 'Confirm Reset for this target and current instance.',
  invalid: 'Invalid emulator request.',
  storage: 'Emulator evidence could not be stored.'
}
export class FlociFailure extends Error {
  constructor(public readonly code: FlociCode) {
    super(flociMessages[code])
  }
}
export const flociReceiptSchema = z
  .object({
    id: z.string().uuid(),
    namespaceId: z.string(),
    projectId: z.string(),
    targetId: z.string().uuid(),
    instanceId: z.string().uuid(),
    epoch: z.number().int(),
    operation: flociOperationSchema,
    ownerPid: z.number().int(),
    at: z.number(),
    finishedAt: z.number().nullable(),
    status: z.enum(['running', 'passed', 'failed', 'interrupted']),
    code: flociCodes
  })
  .strict()
export type FlociReceipt = z.infer<typeof flociReceiptSchema>
export const flociInstanceSchema = z
  .object({
    id: z.string().uuid(),
    namespaceId: z.string().min(1).max(100),
    targetId: z.string().uuid(),
    name: z.string().regex(/^bastion-[a-z0-9-]+$/),
    network: z.string().regex(/^bastion-[a-z0-9-]+$/),
    port: z.number().int().min(1024).max(65535),
    dataPath: z.string().min(1),
    engine: z.enum(['docker', 'podman']),
    engineId: z.string(),
    containerId: z.string().nullable(),
    imageId: z.string().nullable(),
    epoch: z.number().int().nonnegative(),
    state: z.enum([
      'not-started',
      'starting',
      'ready',
      'stopping',
      'stopped',
      'resetting',
      'unknown',
      'failed'
    ]),
    code: flociCodes,
    operationId: z.string().uuid().nullable(),
    operationPid: z.number().int().nullable()
  })
  .strict()
export type FlociInstance = z.infer<typeof flociInstanceSchema>
export type FlociView = { instance: FlociInstance; imageDigest: string; receipts: FlociReceipt[] }
export const flociReadSchema = z
  .object({
    projectId: z.string().min(1).max(4096),
    targetId: z.string().uuid(),
    refresh: z.boolean().optional()
  })
  .strict()
export const flociActionSchema = flociReadSchema
  .omit({ refresh: true })
  .extend({
    requestId: z.string().uuid(),
    operation: flociOperationSchema,
    confirmation: z
      .object({
        targetId: z.string().uuid(),
        instanceId: z.string().uuid(),
        epoch: z.number().int()
      })
      .strict()
      .optional()
  })
  .strict()
export type FlociAction = z.infer<typeof flociActionSchema>
export type FlociResult =
  | { ok: true; runtime: FlociView }
  | { ok: false; code: string; message: string }
