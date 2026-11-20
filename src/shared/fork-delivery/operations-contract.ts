import { z } from 'zod'
import { deliveryConfigSchema, type DeliveryResult } from './delivery-contract'
import type { CertificateEvidence, CertificatesRequest } from './certificate-contract'

/**
 * Fork: Step 12 verification, diagnosis and runbooks for the Delivery page's application.
 * Every finding names its source; anything that cannot be read is unknown, never healthy.
 */
const kubeName = z.string().regex(/^[a-z0-9]([-a-z0-9]{0,61}[a-z0-9])?$/)
export const diagnoseSchema = deliveryConfigSchema
  .extend({
    /** Logs are a sensitive read: fetched only when the engineer asks for them. */
    logs: z.boolean()
  })
  .strict()
export type DiagnoseRequest = z.infer<typeof diagnoseSchema>

export type RolloutState = {
  name: string
  desired: number
  /** All pods, old and new; more than desired means old pods are still serving. */
  total: number
  updated: number
  ready: number
  available: number
  status: 'complete' | 'progressing' | 'failed'
  /** Condition messages, for example "ProgressDeadlineExceeded". */
  conditions: string[]
}
export type ContainerState = {
  pod: string
  container: string
  ready: boolean
  restarts: number
  /** "running", or "waiting CrashLoopBackOff", "terminated Error". */
  state: string
  lastExit: { code: number; reason: string } | null
  digest: string | null
  /** The commit the image's revision label names, or why it is unknown. */
  revision: string | null
  revisionSource: string
}
export type WorkloadEvent = {
  reason: string
  object: string
  message: string
  count: number
  last: string
}
export type LogExcerpt = {
  pod: string
  container: string
  previous: boolean
  text: string
  /** Lines or bytes were cut to stay within the bound. */
  truncated: boolean
  redactions: number
}
export type WorkloadDiagnosis = {
  namespace: string | null
  rollouts: RolloutState[]
  containers: ContainerState[]
  events: WorkloadEvent[]
  logs: LogExcerpt[]
  /** Sources that could not be read, each with its reason. */
  unknown: string[]
  readAt: number
}

export const journeyCheckSchema = z
  .object({
    service: kubeName,
    port: z.number().int().min(1).max(65535),
    path: z
      .string()
      .max(200)
      .regex(/^\/[A-Za-z0-9._~/-]*$/),
    /** The check passes only when the response body contains this text. */
    expect: z.string().min(1).max(200)
  })
  .strict()
export type JourneyCheck = z.infer<typeof journeyCheckSchema>
export const verifySchema = deliveryConfigSchema
  .extend({
    check: journeyCheckSchema,
    kind: z.enum(['check', 'drill']),
    /** A drill is recorded against the runbook it exercised. */
    runbook: z
      .string()
      .regex(/^runbooks\/[a-z0-9][a-z0-9-]{0,80}\.md$/)
      .nullable()
  })
  .strict()
export type VerifyRequest = z.infer<typeof verifySchema>
export type VerificationRun = {
  id: string
  kind: 'check' | 'drill'
  runbook: string | null
  at: number
  passed: boolean
  /** Fixed-shape detail: the status line or why the check could not run. */
  detail: string
  target: string
  revision: string | null
  runningDigests: string[]
}

export const runbookCreateSchema = z
  .object({
    projectId: z.string().min(1).max(4096),
    name: z.string().regex(/^[a-z0-9][a-z0-9-]{0,80}$/),
    content: z
      .string()
      .min(1)
      .max(32 * 1024)
  })
  .strict()
export type RunbookSummary = { path: string; title: string }

export type OperationsApi = {
  diagnose: (request: DiagnoseRequest) => Promise<DeliveryResult<{ diagnosis: WorkloadDiagnosis }>>
  verify: (request: VerifyRequest) => Promise<DeliveryResult<{ run: VerificationRun }>>
  runs: (request: { projectId: string }) => Promise<DeliveryResult<{ runs: VerificationRun[] }>>
  certificates: (
    request: CertificatesRequest
  ) => Promise<DeliveryResult<{ evidence: CertificateEvidence }>>
  runbooks: (request: {
    projectId: string
  }) => Promise<DeliveryResult<{ runbooks: RunbookSummary[] }>>
  createRunbook: (
    request: z.infer<typeof runbookCreateSchema>
  ) => Promise<DeliveryResult<{ path: string }>>
}
