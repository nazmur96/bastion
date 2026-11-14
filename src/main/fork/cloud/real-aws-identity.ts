import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { RealAwsFailure, type RealAwsIdentity } from '../../../shared/fork-cloud/real-aws-contract'
import type { RealAwsContext } from './real-aws-controller'
import type { RealAwsCall } from './real-aws-resources'
import type { RealAwsTool } from './real-aws-tool'

const identitySchema = z.object({
  Account: z.string().regex(/^\d{12}$/),
  Arn: z
    .string()
    .min(1)
    .max(2048)
    .regex(/^arn:aws:(iam|sts)::\d{12}:/),
  UserId: z.string().min(1).max(256)
})
/** Failures that end the whole batch: authentication, identity, owner or tool changed. */
export const STICKY: string[] = [
  'cli-session-expired',
  'service-token-expired',
  'auth-unavailable',
  'identity-mismatch',
  'owner-changed',
  'tool-unavailable'
]
/** Fresh STS identity, checked against the target's expected account and role. */
export function identityCheck(
  call: RealAwsCall,
  context: RealAwsContext,
  tool: RealAwsTool
): (proveRole: boolean) => Promise<RealAwsIdentity> {
  return async (proveRole: boolean): Promise<RealAwsIdentity> => {
    let observed
    try {
      observed = identitySchema.parse(await call('identity', {}))
    } catch (error) {
      if (error instanceof RealAwsFailure) {
        throw error
      }
      throw new RealAwsFailure('unreadable')
    }
    if (observed.Arn.split(':')[4] !== observed.Account) {
      throw new RealAwsFailure('identity-mismatch')
    }
    const config = context.configuration
    if (config.expectedAccountId && config.expectedAccountId !== observed.Account) {
      throw new RealAwsFailure('identity-mismatch')
    }
    let roleArn: string | null = null
    const role = /^arn:aws:sts::\d{12}:assumed-role\/([^/]+)\/[^/]+$/.exec(observed.Arn)
    if (role && (proveRole || config.expectedRoleArn)) {
      try {
        const response = z
          .object({
            Role: z.object({
              Arn: z.string().regex(/^arn:aws:iam::\d{12}:role\/[\w+=,.@/-]+$/),
              RoleId: z.string().min(1).max(256)
            })
          })
          .parse(await call('role', { RoleName: role[1] }))
        if (
          response.Role.Arn.split(':')[4] !== observed.Account ||
          response.Role.RoleId !== observed.UserId.split(':')[0]
        ) {
          throw new RealAwsFailure('identity-mismatch')
        }
        roleArn = response.Role.Arn
      } catch (error) {
        // Without a role expectation an unproven role leaves an account-only anchor.
        if (
          config.expectedRoleArn ||
          !(error instanceof RealAwsFailure) ||
          STICKY.includes(error.code)
        ) {
          throw error
        }
      }
    }
    if (config.expectedRoleArn && config.expectedRoleArn !== roleArn) {
      throw new RealAwsFailure('identity-mismatch')
    }
    return {
      observationId: randomUUID(),
      accountId: observed.Account,
      arn: observed.Arn,
      userId: observed.UserId,
      roleArn,
      profileName: config.profileName,
      region: config.region,
      checkedAt: Date.now(),
      expiresAt: null,
      anchored: Boolean(config.expectedAccountId),
      toolVersion: tool.version
    }
  }
}
