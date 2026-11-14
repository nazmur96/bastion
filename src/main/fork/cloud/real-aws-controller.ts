import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { RealAwsFailure, type RealAwsIdentity } from '../../../shared/fork-cloud/real-aws-contract'
import type { CloudTarget } from '../../../shared/fork-cloud/cloud-target-contract'
import type { CloudTargetCatalog } from './cloud-target-catalog'
import { resolveRealAwsTool } from './real-aws-tool'
import { realAwsProfileEnv } from './real-aws-env'
import { callRealAwsOperation } from './real-aws-operations'
import { listRealAwsResources, type RealAwsCall } from './real-aws-resources'
import { readRealAwsBudgets } from './real-aws-budgets'
export type RealAwsContext = {
  root: string
  configuration: Extract<CloudTarget['configuration'], { kind: 'real' }>
  stamp: string
  current(): void
}
const identitySchema = z.object({
  Account: z.string().regex(/^\d{12}$/),
  Arn: z
    .string()
    .min(1)
    .max(2048)
    .regex(/^arn:aws:(iam|sts)::\d{12}:/),
  UserId: z.string().min(1).max(256)
})
export class RealAwsController {
  private closed = false
  close(): void {
    this.closed = true
    this.observations.clear()
  }
  private observations = new Map<
    string,
    { context: string; tool: string; identity: RealAwsIdentity }
  >()
  private active = new Set<string>()
  constructor(
    private readonly catalog: CloudTargetCatalog,
    private readonly resolve: (projectId: string, targetId: string) => Promise<RealAwsContext>,
    private readonly notify: () => void,
    private readonly dependencies = {
      environment: () => process.env,
      tool: resolveRealAwsTool,
      call: callRealAwsOperation
    }
  ) {}
  private async session(projectId: string, targetId: string) {
    if (this.closed) {
      throw new RealAwsFailure('owner-changed')
    }
    const original = await this.resolve(projectId, targetId)
    const context = {
      ...original,
      current: () => {
        if (this.closed) {
          throw new RealAwsFailure('owner-changed')
        }
        original.current()
      }
    }
    context.current()
    const ownerEnv = this.dependencies.environment()
    const tool = await this.dependencies.tool(context.root, ownerEnv)
    context.current()
    const env = realAwsProfileEnv(
      context.configuration.profileName,
      context.configuration.region,
      ownerEnv
    )
    const deadline = Date.now() + 60000,
      operations: string[] = []
    let failed: RealAwsFailure | undefined
    const call: RealAwsCall = async (operation, parameters) => {
      if (failed) {
        throw failed
      }
      context.current()
      tool.assertCurrent()
      const remaining = deadline - Date.now()
      if (remaining <= 0) {
        throw new RealAwsFailure('timeout')
      }
      try {
        const value = await this.dependencies.call(
          tool,
          env,
          context.root,
          operation,
          parameters,
          remaining,
          operations
        )
        context.current()
        return value
      } catch (error) {
        if (
          error instanceof RealAwsFailure &&
          [
            'cli-session-expired',
            'service-token-expired',
            'auth-unavailable',
            'identity-mismatch',
            'owner-changed',
            'tool-unavailable'
          ].includes(error.code)
        ) {
          failed ??= error
        }
        throw error
      }
    }
    const check = async (): Promise<RealAwsIdentity> => {
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
      if (role) {
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
          if (
            !(error instanceof RealAwsFailure && error.code === 'denied' && !config.expectedRoleArn)
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
    return { context, tool, call, check, operations }
  }
  private sameIdentity(a: RealAwsIdentity, b: RealAwsIdentity): boolean {
    return (
      a.accountId === b.accountId &&
      a.arn === b.arn &&
      a.userId === b.userId &&
      a.roleArn === b.roleArn
    )
  }
  private async exclusive<T>(
    projectId: string,
    targetId: string,
    action: () => Promise<T>
  ): Promise<T> {
    const key = JSON.stringify([projectId, targetId])
    if (this.active.has(key)) {
      throw new RealAwsFailure('busy')
    }
    this.active.add(key)
    try {
      return await action()
    } finally {
      this.active.delete(key)
    }
  }
  async verify(projectId: string, targetId: string): Promise<RealAwsIdentity> {
    return this.exclusive(projectId, targetId, async () => {
      const session = await this.session(projectId, targetId),
        identity = await session.check()
      session.context.current()
      session.tool.assertCurrent()
      for (const [id, previous] of this.observations) {
        if (Date.now() - previous.identity.checkedAt > 60000) {
          this.observations.delete(id)
        }
      }
      if (this.observations.size >= 200) {
        this.observations.delete(this.observations.keys().next().value ?? '')
      }
      this.observations.set(identity.observationId, {
        context: session.context.stamp,
        tool: session.tool.fingerprint,
        identity
      })
      return identity
    })
  }
  async accept(
    projectId: string,
    targetId: string,
    observationId: string,
    revision: number
  ): Promise<RealAwsIdentity> {
    return this.exclusive(projectId, targetId, async () => {
      const previous = this.observations.get(observationId)
      this.observations.delete(observationId)
      if (!previous || Date.now() - previous.identity.checkedAt > 60000) {
        throw new RealAwsFailure('identity-required')
      }
      const session = await this.session(projectId, targetId)
      if (
        previous.context !== session.context.stamp ||
        previous.tool !== session.tool.fingerprint
      ) {
        throw new RealAwsFailure('owner-changed')
      }
      const fresh = await session.check()
      if (!this.sameIdentity(fresh, previous.identity)) {
        throw new RealAwsFailure('identity-mismatch')
      }
      session.context.current()
      this.catalog.mutate(revision, {
        kind: 'update-real',
        id: targetId,
        configuration: {
          ...session.context.configuration,
          expectedAccountId: fresh.accountId,
          ...(fresh.roleArn ? { expectedRoleArn: fresh.roleArn } : {})
        }
      })
      this.notify()
      return { ...fresh, anchored: true }
    })
  }
  async read(projectId: string, targetId: string, operation: 'resources' | 'budgets') {
    return this.exclusive(projectId, targetId, async () => {
      const session = await this.session(projectId, targetId)
      if (!session.context.configuration.expectedAccountId) {
        throw new RealAwsFailure('identity-required')
      }
      const before = await session.check()
      const data =
        operation === 'resources'
          ? await listRealAwsResources(session.call, before.accountId)
          : await readRealAwsBudgets(session.call, before.accountId)
      const after = await session.check()
      if (!this.sameIdentity(before, after)) {
        throw new RealAwsFailure('identity-mismatch')
      }
      session.context.current()
      session.tool.assertCurrent()
      return { identity: after, data, operations: session.operations }
    })
  }
}
