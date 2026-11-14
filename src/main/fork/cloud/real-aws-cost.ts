import { randomUUID } from 'node:crypto'
import {
  RealAwsFailure,
  type RealAwsCostChallenge,
  type RealAwsCostData,
  type RealAwsCostGrant,
  type RealAwsCostQuery,
  type RealAwsCostView,
  type RealAwsIdentity,
  type RealAwsReadReceipt
} from '../../../shared/fork-cloud/real-aws-contract'
import type { ChangeLedger } from '../changes/change-ledger'
import type { RealAwsContext } from './real-aws-controller'
import type { RealAwsCall } from './real-aws-resources'
import type { RealAwsTool } from './real-aws-tool'
import {
  costQuery,
  evict,
  fingerprint,
  identityFingerprint,
  projectCost
} from './real-aws-read-evidence'

export type RealAwsSession = {
  context: RealAwsContext
  tool: RealAwsTool
  call: RealAwsCall
  check(proveRole: boolean): Promise<RealAwsIdentity>
}
type Open = (projectId: string, targetId: string) => Promise<RealAwsSession>
type Pending = {
  projectId: string
  targetId: string
  requestId: string
  windowId: string
  stamp: string
  tool: string
  identity: string
  query: RealAwsCostQuery
  expiresAt: number
}
type Cached = {
  requestId: string
  stamp: string
  query: string
  accountId: string
  observedAt: number
  data: RealAwsCostData
}
const CONSENT_MS = 60000,
  CACHE_MS = 3600000

function viewOf(receipt: RealAwsReadReceipt, cached?: Cached): RealAwsCostView {
  return {
    requestId: receipt.requestId,
    status: receipt.status,
    ...(receipt.code ? { code: receipt.code } : {}),
    ...(cached && receipt.status === 'completed'
      ? { observedAt: cached.observedAt, accountId: cached.accountId, data: cached.data }
      : {})
  }
}

/** Cost Explorer: a main-held one-use grant, a receipt before the paid call, one attempt. */
export class RealAwsCostDesk {
  private challenges = new Map<string, Pending>()
  private grants = new Map<string, Pending>()
  private inflight = new Map<string, Promise<RealAwsCostView>>()
  private cache = new Map<string, Cached>()
  constructor(
    private readonly open: Open,
    private readonly ledger: ChangeLedger | undefined,
    private readonly ownerRunId: string
  ) {}
  close(): void {
    this.challenges.clear()
    this.grants.clear()
    this.cache.clear()
  }
  private requireLedger(): ChangeLedger {
    if (!this.ledger) {
      throw new RealAwsFailure('storage')
    }
    return this.ledger
  }
  async prepare(
    projectId: string,
    targetId: string,
    requestId: string,
    windowId: string
  ): Promise<RealAwsCostChallenge> {
    if (this.requireLedger().readReceipt(requestId)) {
      throw new RealAwsFailure('duplicate')
    }
    const session = await this.open(projectId, targetId)
    if (!session.context.configuration.expectedAccountId) {
      throw new RealAwsFailure('identity-required')
    }
    const identity = await session.check(false),
      query = costQuery(identity.accountId)
    if (!query) {
      throw new RealAwsFailure('no-cost-period')
    }
    session.context.current()
    const now = Date.now(),
      challengeId = randomUUID()
    evict(this.challenges, now)
    this.challenges.set(challengeId, {
      projectId,
      targetId,
      requestId,
      windowId,
      stamp: session.context.stamp,
      tool: session.tool.fingerprint,
      identity: identityFingerprint(identity),
      query,
      expiresAt: now + CONSENT_MS
    })
    return {
      challengeId,
      requestId,
      accountId: identity.accountId,
      principalArn: identity.arn,
      profileName: session.context.configuration.profileName,
      endpointRegion: 'us-east-1',
      query,
      expiresAt: now + CONSENT_MS
    }
  }
  confirm(
    projectId: string,
    targetId: string,
    challengeId: string,
    windowId: string
  ): RealAwsCostGrant {
    const challenge = this.challenges.get(challengeId),
      now = Date.now()
    this.challenges.delete(challengeId)
    if (
      !challenge ||
      challenge.expiresAt <= now ||
      challenge.projectId !== projectId ||
      challenge.targetId !== targetId ||
      challenge.windowId !== windowId
    ) {
      throw new RealAwsFailure('consent-required')
    }
    const grantId = randomUUID()
    evict(this.grants, now)
    this.grants.set(grantId, { ...challenge, expiresAt: now + CONSENT_MS })
    return { grantId, expiresAt: now + CONSENT_MS }
  }
  /** Synchronous until the in-flight entry exists, so a duplicate UUID never starts a second attempt. */
  read(
    projectId: string,
    targetId: string,
    requestId: string,
    grantId: unknown,
    windowId: string
  ): Promise<RealAwsCostView> {
    try {
      const running = this.inflight.get(requestId)
      if (running) {
        return running
      }
      const existing = this.requireLedger().readReceipt(requestId)
      if (existing) {
        if (
          existing.operation !== 'cost-and-usage' ||
          existing.projectId !== projectId ||
          existing.targetId !== targetId
        ) {
          throw new RealAwsFailure('invalid')
        }
        const cached = this.cache.get(JSON.stringify([projectId, targetId]))
        return Promise.resolve(
          viewOf(existing, cached?.requestId === requestId ? cached : undefined)
        )
      }
      const grant = typeof grantId === 'string' ? this.grants.get(grantId) : undefined
      if (
        !grant ||
        typeof grantId !== 'string' ||
        grant.expiresAt <= Date.now() ||
        grant.requestId !== requestId ||
        grant.projectId !== projectId ||
        grant.targetId !== targetId ||
        grant.windowId !== windowId
      ) {
        throw new RealAwsFailure('consent-required')
      }
      this.grants.delete(grantId)
      const attempt = this.attempt(grant).finally(() => this.inflight.delete(requestId))
      this.inflight.set(requestId, attempt)
      return attempt
    } catch (error) {
      return Promise.reject(error)
    }
  }
  private async attempt(grant: Pending): Promise<RealAwsCostView> {
    const session = await this.open(grant.projectId, grant.targetId),
      query = costQuery(grant.query.Filter.Dimensions.Values[0])
    if (session.context.stamp !== grant.stamp || session.tool.fingerprint !== grant.tool) {
      throw new RealAwsFailure('owner-changed')
    }
    // A new UTC day changes the query the engineer confirmed.
    if (!query || fingerprint(query) !== fingerprint(grant.query)) {
      throw new RealAwsFailure('consent-required')
    }
    const ledger = this.requireLedger()
    const receipt: RealAwsReadReceipt = {
      requestId: grant.requestId,
      namespaceId: session.context.namespaceId ?? 'local',
      projectId: grant.projectId,
      targetId: grant.targetId,
      operation: 'cost-and-usage',
      contextFingerprint: fingerprint([grant.stamp, grant.tool, grant.query]),
      toolFingerprint: fingerprint(grant.tool),
      identityFingerprint: grant.identity,
      ownerRunId: this.ownerRunId,
      at: Date.now(),
      status: 'running'
    }
    try {
      ledger.admitReadReceipt(receipt)
    } catch {
      // No durable receipt means no paid request.
      throw new RealAwsFailure('storage')
    }
    let charged = false
    try {
      const before = await session.check(false)
      if (identityFingerprint(before) !== grant.identity) {
        throw new RealAwsFailure('identity-mismatch')
      }
      charged = true
      const data = projectCost(await session.call('cost-and-usage', grant.query))
      const after = await session.check(false)
      if (identityFingerprint(after) !== grant.identity) {
        throw new RealAwsFailure('identity-mismatch')
      }
      session.context.current()
      const observedAt = Date.now()
      ledger.settleReadReceipt({
        ...receipt,
        status: 'completed',
        finishedAt: observedAt,
        code: 'ok',
        results: [{ code: 'ok', count: data.results.length, truncated: data.moreAvailable }]
      })
      this.cache.set(JSON.stringify([grant.projectId, grant.targetId]), {
        requestId: grant.requestId,
        stamp: grant.stamp,
        query: fingerprint(grant.query),
        accountId: before.accountId,
        observedAt,
        data
      })
      return {
        requestId: grant.requestId,
        status: 'completed',
        observedAt,
        accountId: before.accountId,
        query: grant.query,
        data
      }
    } catch (error) {
      const code = error instanceof RealAwsFailure ? error.code : 'unreadable'
      // After launch, a lost or timed-out result may still have been charged: unknown, never retried.
      const uncertain = charged && (code === 'timeout' || code === 'owner-changed')
      try {
        ledger.settleReadReceipt({
          ...receipt,
          status: uncertain ? 'unknown' : 'failed',
          finishedAt: Date.now(),
          code
        })
      } catch {
        // Already settled by recovery; the recorded unknown stands.
      }
      throw error
    }
  }
  /** Passive: no tool, identity or billing request. A miss stays a miss. */
  cached(projectId: string, targetId: string, context: RealAwsContext): RealAwsCostView | null {
    const key = JSON.stringify([projectId, targetId]),
      entry = this.cache.get(key)
    if (!entry) {
      return null
    }
    const query = costQuery(entry.accountId)
    if (
      Date.now() - entry.observedAt >= CACHE_MS ||
      entry.stamp !== context.stamp ||
      !query ||
      fingerprint(query) !== entry.query
    ) {
      this.cache.delete(key)
      return null
    }
    return {
      requestId: entry.requestId,
      status: 'completed',
      observedAt: entry.observedAt,
      accountId: entry.accountId,
      query,
      data: entry.data
    }
  }
}
