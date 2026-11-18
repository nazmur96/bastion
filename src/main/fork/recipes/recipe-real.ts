import { randomUUID } from 'node:crypto'
import { appendFile } from 'node:fs/promises'
import { join } from 'node:path'
import { runProcess } from '@orca/process-host'
import type { RealAwsIdentity } from '../../../shared/fork-cloud/real-aws-contract'
import type { RecipeStep } from '../../../shared/fork-recipes/recipe-contract'
import { recipeFingerprint } from './recipe-fingerprint'
import { readRecipeFiles } from './recipe-files'
import {
  RecipeRunError,
  baseEnv,
  privateDirectory,
  terraformChange,
  type RunTerraform
} from './recipe-runner'
import type { TerraformTool } from './terraform-tool'
import { realAwsProfileEnv } from '../cloud/real-aws-env'

type Anchored = {
  identity: RealAwsIdentity
  root: string
  stamp: string
  current: () => void
}
export type RealRecipeRequest = {
  projectId: string
  targetId: string
  directory: string
  fingerprint: string
  operation: 'apply' | 'destroy'
}
type Grant = RealRecipeRequest & { stamp: string; principal: string; expiresAt: number }
export type RealRecipeChallenge = {
  grantId: string
  operation: 'apply' | 'destroy'
  directory: string
  files: string[]
  fingerprint: string
  accountId: string
  principalArn: string
  profileName: string
  region: string
  terraform: string
}
const GRANT_TTL = 60000

/**
 * Fork: a reviewed recipe applied to, or destroyed from, real AWS. The account must be the
 * accepted anchor, checked fresh at preparation and again at the start; the confirmation
 * mints a main-held grant used once. Terraform runs in the project's own recipe directory,
 * so its state stays with the source and the engineer can always inspect or destroy it with
 * plain Terraform, without Bastion.
 */
export class RealRecipeDesk {
  private readonly grants = new Map<string, Grant>()
  constructor(
    private readonly dataRoot: string,
    private readonly anchored: (projectId: string, targetId: string) => Promise<Anchored>,
    private readonly tool: (root: string) => Promise<TerraformTool>,
    private readonly owner: NodeJS.ProcessEnv = process.env,
    private readonly run: RunTerraform = runProcess
  ) {}

  async prepare(request: RealRecipeRequest): Promise<RealRecipeChallenge> {
    const session = await this.anchored(request.projectId, request.targetId)
    const files = await readRecipeFiles(session.root, request.directory)
    if (recipeFingerprint(files) !== request.fingerprint) {
      throw new RecipeRunError('changed')
    }
    const tool = await this.tool(session.root)
    for (const [id, grant] of this.grants) {
      if (grant.expiresAt < Date.now()) {
        this.grants.delete(id)
      }
    }
    const grantId = randomUUID()
    this.grants.set(grantId, {
      ...request,
      stamp: session.stamp,
      principal: session.identity.arn,
      expiresAt: Date.now() + GRANT_TTL
    })
    return {
      grantId,
      operation: request.operation,
      directory: request.directory,
      files: files.map((file) => file.path),
      fingerprint: request.fingerprint,
      accountId: session.identity.accountId,
      principalArn: session.identity.arn,
      profileName: session.identity.profileName,
      region: session.identity.region,
      terraform: tool.version
    }
  }

  /** The operation a grant was minted for, so the caller can admit the matching policy entry. */
  pendingOperation(grantId: string): 'apply' | 'destroy' | null {
    return this.grants.get(grantId)?.operation ?? null
  }

  cancel(grantId: string): void {
    this.grants.delete(grantId)
  }

  async deliver(
    grantId: string
  ): Promise<{ steps: RecipeStep[]; outputs: Record<string, string>; receiptId: string }> {
    const grant = this.grants.get(grantId)
    // One use: consumed before anything else, whatever happens next.
    this.grants.delete(grantId)
    if (!grant || grant.expiresAt < Date.now()) {
      throw new RecipeRunError('grant')
    }
    const session = await this.anchored(grant.projectId, grant.targetId)
    if (session.stamp !== grant.stamp || session.identity.arn !== grant.principal) {
      throw new RecipeRunError('grant')
    }
    const files = await readRecipeFiles(session.root, grant.directory)
    if (recipeFingerprint(files) !== grant.fingerprint) {
      throw new RecipeRunError('changed')
    }
    const tool = await this.tool(session.root)
    session.current()
    const receiptId = randomUUID()
    const receipt = (status: string, extra: Record<string, unknown> = {}) =>
      this.record({
        id: receiptId,
        at: Date.now(),
        status,
        operation: grant.operation,
        directory: grant.directory,
        fingerprint: grant.fingerprint,
        accountId: session.identity.accountId,
        principalArn: session.identity.arn,
        region: session.identity.region,
        ...extra
      })
    // Recorded before the first provider call: a crash leaves a started receipt, never silence.
    await receipt('started')
    try {
      const result = await terraformChange(
        this.run,
        tool,
        grant.operation,
        join(session.root, grant.directory),
        {
          ...baseEnv(
            this.owner,
            privateDirectory(join(this.dataRoot, 'bastion-recipes', 'plugin-cache'))
          ),
          // The engineer's own profile; the anchor check above proved its account.
          ...realAwsProfileEnv(session.identity.profileName, session.identity.region, this.owner)
        }
      )
      const passed = result.steps.every((item) => item.ok)
      await receipt(passed ? 'passed' : 'failed', {
        steps: result.steps.map((item) => ({ step: item.step, ok: item.ok }))
      })
      return { ...result, receiptId }
    } catch (error) {
      await receipt('unknown')
      throw error
    }
  }

  private async record(entry: Record<string, unknown>): Promise<void> {
    const directory = privateDirectory(join(this.dataRoot, 'bastion-recipes'))
    await appendFile(join(directory, 'real-receipts.jsonl'), `${JSON.stringify(entry)}\n`, {
      mode: 0o600
    })
  }
}
