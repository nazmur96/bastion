import { randomUUID } from 'node:crypto'
import {
  RealAwsFailure,
  type RealAwsIdentity,
  type RealAwsResources,
  type RealAwsBudgets
} from '../../../shared/fork-cloud/real-aws-contract'
import type { CloudTarget } from '../../../shared/fork-cloud/cloud-target-contract'
import type { ChangeLedger } from '../changes/change-ledger'
import type { CloudTargetCatalog } from './cloud-target-catalog'
import { resolveRealAwsTool } from './real-aws-tool'
import { realAwsProfileEnv } from './real-aws-env'
import { callRealAwsOperation } from './real-aws-operations'
import type { RealAwsCall } from './real-aws-resources'
import { identityCheck, STICKY } from './real-aws-identity'
import { RealAwsCostDesk } from './real-aws-cost'
import { readRealAwsBatch } from './real-aws-read-batch'
export type RealAwsContext = {
  root: string
  configuration: Extract<CloudTarget['configuration'], { kind: 'real' }>
  stamp: string
  namespaceId?: string
  current(): void
}
type Dependencies = {
  environment: () => NodeJS.ProcessEnv
  tool: typeof resolveRealAwsTool
  call: typeof callRealAwsOperation
  /** Durable read receipts; required for Cost Explorer. */
  ledger?: ChangeLedger
  ownerRunId?: string
  /** Default window for direct callers; the IPC layer passes the sender's window. */
  windowId?: string
}
export class RealAwsController {
  private closed = false
  close(): void {
    this.closed = true
    this.observations.clear()
    this.cost.close()
  }
  private observations = new Map<
    string,
    { context: string; tool: string; identity: RealAwsIdentity }
  >()
  private active = new Set<string>()
  private results = new Map<
    string,
    { identity: RealAwsIdentity; data: RealAwsResources | RealAwsBudgets; operations: string[] }
  >()
  private readonly cost: RealAwsCostDesk
  private readonly ownerRunId: string
  constructor(
    private readonly catalog: CloudTargetCatalog,
    private readonly resolve: (projectId: string, targetId: string) => Promise<RealAwsContext>,
    private readonly notify: () => void,
    private readonly dependencies: Dependencies = {
      environment: () => process.env,
      tool: resolveRealAwsTool,
      call: callRealAwsOperation
    }
  ) {
    this.ownerRunId = dependencies.ownerRunId ?? randomUUID()
    this.cost = new RealAwsCostDesk(
      (projectId, targetId) => this.session(projectId, targetId),
      dependencies.ledger,
      this.ownerRunId
    )
  }
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
        if (error instanceof RealAwsFailure && STICKY.includes(error.code)) {
          failed ??= error
        }
        throw error
      }
    }
    const check = identityCheck(call, context, tool)
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
        identity = await session.check(true)
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
      const fresh = await session.check(true)
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
  async read(
    projectId: string,
    targetId: string,
    operation: 'resources' | 'budgets',
    requestId?: string
  ) {
    const ledger = this.dependencies.ledger
    const existing = requestId && ledger ? ledger.readReceipt(requestId) : null
    if (requestId && existing) {
      // A repeated request returns its own result once; it never starts a second batch.
      const previous = this.results.get(requestId)
      if (
        existing.operation !== operation ||
        existing.projectId !== projectId ||
        existing.targetId !== targetId
      ) {
        throw new RealAwsFailure('invalid')
      }
      if (!previous) {
        throw new RealAwsFailure('duplicate')
      }
      return previous
    }
    const result = await this.exclusive(projectId, targetId, async () =>
      readRealAwsBatch(await this.session(projectId, targetId), {
        projectId,
        targetId,
        operation,
        requestId,
        ledger,
        ownerRunId: this.ownerRunId
      })
    )
    if (requestId) {
      if (this.results.size >= 200) {
        this.results.delete(this.results.keys().next().value ?? '')
      }
      this.results.set(requestId, result)
    }
    return result
  }
  prepareCost(projectId: string, targetId: string, requestId: string, windowId = this.window()) {
    return this.exclusive(projectId, targetId, () =>
      this.cost.prepare(projectId, targetId, requestId, windowId)
    )
  }
  confirmCost(projectId: string, targetId: string, challengeId: string, windowId = this.window()) {
    return this.cost.confirm(projectId, targetId, challengeId, windowId)
  }
  readCost(
    projectId: string,
    targetId: string,
    requestId: string,
    grantId: unknown,
    windowId = this.window()
  ) {
    if (this.closed) {
      return Promise.reject(new RealAwsFailure('owner-changed'))
    }
    return this.cost.read(projectId, targetId, requestId, grantId, windowId)
  }
  /** Passive cache lookup: no tool, identity or billing request. */
  async cachedCost(projectId: string, targetId: string) {
    try {
      return this.closed
        ? null
        : this.cost.cached(projectId, targetId, await this.resolve(projectId, targetId))
    } catch {
      return null
    }
  }
  private window(): string {
    return this.dependencies.windowId ?? 'main'
  }
}
