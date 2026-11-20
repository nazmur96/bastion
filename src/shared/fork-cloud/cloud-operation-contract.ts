import { z } from 'zod'
import { FileMutationOpen } from '../rpc-contract/files-mutation-params'

/**
 * Fork: cloud operations that a project's owning runtime performs for it. A remote (SSH) owner
 * runs them with its own tools and credentials; nothing runs on this computer on its behalf.
 * Only stateless, project-rooted operations are admitted. Operations whose state lives in the
 * local workspace (targets, identity anchors, receipts) or that write source stay refused.
 */
export const REMOTE_CLOUD_OPERATIONS = [
  'delivery.evidence',
  'operations.diagnose',
  'operations.logs',
  'operations.verify',
  'operations.runs',
  'operations.certificates',
  'operations.backups',
  'operations.monitoring',
  'operations.recurring'
] as const
export type RemoteCloudOperation = (typeof REMOTE_CLOUD_OPERATIONS)[number]

export const CloudOperationCall = FileMutationOpen.omit({ relativePath: true })
  .extend({
    expectedRoot: z.string().min(1).max(4096),
    expectedRuntimeId: z.string().min(1).max(4096),
    operation: z.enum(REMOTE_CLOUD_OPERATIONS),
    /** Parsed on the owner with the operation's own strict schema. */
    request: z.unknown()
  })
  .strict()
export type CloudOperationCallParams = z.infer<typeof CloudOperationCall>
