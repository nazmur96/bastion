import { randomUUID } from 'node:crypto'
import { appendFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { runProcess } from '@orca/process-host'
import type { RealAwsIdentity } from '../../../shared/fork-cloud/real-aws-contract'
import type { RecipePlanSummary, RecipeStep } from '../../../shared/fork-recipes/recipe-contract'
import { summarizePlan } from './recipe-plan'
import { recipeFingerprint } from './recipe-fingerprint'
import { readRecipeFiles } from './recipe-files'
import {
  RecipeRunError,
  baseEnv,
  privateDirectory,
  parseOutputs,
  step,
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
type Grant = RealRecipeRequest & {
  stamp: string
  principal: string
  expiresAt: number
  planFile: string
  plan: RecipePlanSummary
}
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
  plan: RecipePlanSummary
}
/** Long enough to read the plan; Terraform itself refuses a plan whose state went stale. */
const GRANT_TTL = 5 * 60000

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
        this.discard(id)
      }
    }
    const grantId = randomUUID()
    const planFile = join(
      privateDirectory(join(this.dataRoot, 'bastion-recipes', 'real-plans')),
      `${grantId}.tfplan`
    )
    const work = join(session.root, request.directory)
    const env = this.env(session.identity)
    for (const [name, args, timeout] of [
      ['init', ['init', '-input=false', '-no-color'], 180000],
      [
        'plan',
        [
          'plan',
          ...(request.operation === 'destroy' ? ['-destroy'] : []),
          '-input=false',
          '-no-color',
          `-out=${planFile}`
        ],
        300000
      ]
    ] as const) {
      const result = await step(this.run, tool, name, [...args], work, env, timeout)
      if (!result.ok) {
        await rm(planFile, { force: true })
        throw new RecipeRunError('plan', result.message)
      }
    }
    const shown = await step(
      this.run,
      tool,
      'plan',
      ['show', '-json', '-no-color', planFile],
      work,
      env,
      60000
    )
    const plan = shown.ok ? summarizePlan(shown.stdout) : null
    if (!plan) {
      await rm(planFile, { force: true })
      throw new RecipeRunError('plan', shown.message ?? 'The plan could not be read.')
    }
    // init may add .terraform.lock.hcl; the grant binds the files exactly as planned.
    const planned = await readRecipeFiles(session.root, request.directory)
    const plannedFingerprint = recipeFingerprint(planned)
    this.grants.set(grantId, {
      ...request,
      fingerprint: plannedFingerprint,
      stamp: session.stamp,
      principal: session.identity.arn,
      expiresAt: Date.now() + GRANT_TTL,
      planFile,
      plan
    })
    return {
      grantId,
      operation: request.operation,
      directory: request.directory,
      files: planned.map((file) => file.path),
      fingerprint: plannedFingerprint,
      accountId: session.identity.accountId,
      principalArn: session.identity.arn,
      profileName: session.identity.profileName,
      region: session.identity.region,
      terraform: tool.version,
      plan
    }
  }

  private env(identity: RealAwsIdentity): Record<string, string> {
    return {
      ...baseEnv(
        this.owner,
        privateDirectory(join(this.dataRoot, 'bastion-recipes', 'plugin-cache'))
      ),
      // The engineer's own profile; the anchor check proved its account.
      ...realAwsProfileEnv(identity.profileName, identity.region, this.owner)
    }
  }

  private discard(grantId: string): void {
    const grant = this.grants.get(grantId)
    this.grants.delete(grantId)
    if (grant) {
      void rm(grant.planFile, { force: true })
    }
  }

  /** The operation a grant was minted for, so the caller can admit the matching policy entry. */
  pendingOperation(grantId: string): 'apply' | 'destroy' | null {
    return this.grants.get(grantId)?.operation ?? null
  }

  cancel(grantId: string): void {
    this.discard(grantId)
  }

  async deliver(
    grantId: string
  ): Promise<{ steps: RecipeStep[]; outputs: Record<string, string>; receiptId: string }> {
    const grant = this.grants.get(grantId)
    // One use: consumed before anything else, whatever happens next.
    this.grants.delete(grantId)
    if (!grant || grant.expiresAt < Date.now()) {
      if (grant) {
        await rm(grant.planFile, { force: true })
      }
      throw new RecipeRunError('grant')
    }
    try {
      return await this.applyPlan(grant)
    } finally {
      await rm(grant.planFile, { force: true })
    }
  }

  private async applyPlan(
    grant: Grant
  ): Promise<{ steps: RecipeStep[]; outputs: Record<string, string>; receiptId: string }> {
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
        plan: {
          add: grant.plan.add,
          change: grant.plan.change,
          replace: grant.plan.replace,
          destroy: grant.plan.destroy
        },
        ...extra
      })
    // Recorded before the first provider call: a crash leaves a started receipt, never silence.
    await receipt('started')
    try {
      const work = join(session.root, grant.directory)
      const env = this.env(session.identity)
      // Exactly the reviewed plan: Terraform refuses it if the real state changed since.
      const applied = await step(
        this.run,
        tool,
        grant.operation,
        ['apply', '-input=false', '-no-color', grant.planFile],
        work,
        env,
        600000
      )
      const steps: RecipeStep[] = [{ step: applied.step, ok: applied.ok, message: applied.message }]
      let outputs: Record<string, string> = {}
      if (applied.ok && grant.operation === 'apply') {
        const output = await step(
          this.run,
          tool,
          'output',
          ['output', '-json', '-no-color'],
          work,
          env,
          30000
        )
        outputs = parseOutputs(output.stdout)
      }
      const result = { steps, outputs }
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
