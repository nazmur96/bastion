import { z } from 'zod'
import { deliveryConfigSchema, type DeliveryResult } from './delivery-contract'

/**
 * Fork: Step 14.4 backup evidence. Velero backups and schedules that cover the application's
 * namespace, and the latest recorded restore drill. Read-only; anything that cannot be read is
 * unknown with its reason, never healthy. RDS backups are read through the Real AWS target.
 */
export const backupsSchema = deliveryConfigSchema
  .extend({
    veleroNamespace: z.string().regex(/^[a-z0-9]([-a-z0-9]{0,61}[a-z0-9])?$/),
    /** A newest completed backup older than this is a mismatch. */
    staleHours: z
      .number()
      .int()
      .min(1)
      .max(24 * 31),
    /** A restore drill older than this is a mismatch. */
    drillDays: z.number().int().min(1).max(365)
  })
  .strict()
export type BackupsRequest = z.infer<typeof backupsSchema>

export type BackupFinding = {
  /** velero/<name> for a backup or schedule, the runbook path for a drill. */
  subject: string
  status: 'verified' | 'mismatch' | 'unknown'
  /** Fixed-shape reason, for example "last completed 3 hours ago". */
  detail: string
  at: string | null
  source: string
}
export type BackupEvidence = {
  namespace: string | null
  staleHours: number
  backups: BackupFinding[]
  schedules: BackupFinding[]
  drill: BackupFinding
  /** Sources that could not be read at all, with their reason. */
  unknown: string[]
  readAt: number
}
export type BackupsApi = {
  read: (request: BackupsRequest) => Promise<DeliveryResult<{ evidence: BackupEvidence }>>
}
