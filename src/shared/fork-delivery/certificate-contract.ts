import { z } from 'zod'
import { deliveryConfigSchema, type DeliveryResult } from './delivery-contract'

/**
 * Fork: Step 14.3 certificate evidence. TLS endpoints the engineer lists, and cert-manager
 * Certificates in the application's namespace. Read-only; anything that cannot be read is
 * unknown with its reason, never healthy.
 */
const endpoint = z
  .string()
  .max(260)
  .regex(
    /^(?=.{1,253}(?::\d{1,5})?$)[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*(?::\d{1,5})?$/
  )
export const certificatesSchema = deliveryConfigSchema
  .extend({
    endpoints: z.array(endpoint).max(10),
    /** Expiring within this many days is reported as a mismatch. */
    warnDays: z.number().int().min(1).max(90)
  })
  .strict()
export type CertificatesRequest = z.infer<typeof certificatesSchema>

export type CertificateFinding = {
  /** host:port for an endpoint, namespace/name for a cert-manager Certificate. */
  subject: string
  status: 'verified' | 'mismatch' | 'unknown'
  /** Fixed-shape reason, for example "expires in 12 days" or "hostname does not match". */
  detail: string
  notAfter: string | null
  daysLeft: number | null
  issuer: string | null
  source: string
}
export type CertificateEvidence = {
  warnDays: number
  endpoints: CertificateFinding[]
  certificates: CertificateFinding[]
  /** Sources that could not be read at all, with their reason. */
  unknown: string[]
  readAt: number
}
export type CertificatesApi = {
  read: (request: CertificatesRequest) => Promise<DeliveryResult<{ evidence: CertificateEvidence }>>
}
