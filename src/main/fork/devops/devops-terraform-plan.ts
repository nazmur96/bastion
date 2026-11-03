import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join, normalize } from 'node:path'
import { MISE_FILES, resolveTool } from './devops-inspect'
import { workspaceEnv } from './devops-context'
import { devopsSandboxEnvFor } from './devops-sandbox'
import { runPlanGates } from './devops-plan-gates'
import {
  parseTerraformOutputs,
  summarizeTerraformPlan,
  type PlanGates,
  type TerraformPlanResult
} from '../../../shared/fork-terraform-plan'

const PLAN_TIMEOUT_MS = 10 * 60_000

/**
 * Plan only: init when the directory has never been initialised, then `plan -out`
 * and `show -json`. Nothing is applied; the plan file is kept for a human apply.
 */
export async function runTerraformPlan(
  workspacePath: string,
  dir: string,
  /** refresh-only: drift check; destroy: what tearing it all down would remove. */
  mode: 'plan' | 'refresh-only' | 'destroy' = 'plan'
): Promise<TerraformPlanResult> {
  const refreshOnly = mode === 'refresh-only'
  const relative = normalize(dir)
  if (isAbsolute(relative) || relative.startsWith('..')) {
    return { ok: false, error: 'The Terraform directory must be inside the workspace.' }
  }
  const usesMise = MISE_FILES.some((name) => existsSync(join(workspacePath, name)))
  const terraform = await resolveTool(workspacePath, 'terraform', usesMise)
  if (!terraform.available) {
    return { ok: false, error: terraform.hint }
  }
  const env = {
    ...process.env,
    ...(await workspaceEnv(workspacePath)),
    ...devopsSandboxEnvFor(workspacePath),
    TF_IN_AUTOMATION: '1'
  }
  const exec = (args: string[]): Promise<{ ok: boolean; out: string }> =>
    new Promise((resolve) => {
      const full = [`-chdir=${relative}`, ...args]
      execFile(
        terraform.runner === 'mise' ? 'mise' : 'terraform',
        terraform.runner === 'mise' ? ['exec', '--', 'terraform', ...full] : full,
        { cwd: workspacePath, env, timeout: PLAN_TIMEOUT_MS, maxBuffer: 128 * 1024 * 1024 },
        (error, stdout, stderr) =>
          resolve({
            ok: !error,
            out: error ? `${String(stderr)}\n${String(stdout)}`.trim() : String(stdout)
          })
      )
    })
  if (!existsSync(join(workspacePath, relative, '.terraform'))) {
    const init = await exec(['init', '-input=false', '-no-color'])
    if (!init.ok) {
      return { ok: false, error: lastLines(init.out) }
    }
  }
  const plans = join(tmpdir(), 'orca-fork-plans')
  mkdirSync(plans, { recursive: true })
  const id = createHash('sha256').update(`${workspacePath}\0${relative}`).digest('hex').slice(0, 16)
  const planFile = join(plans, `${id}.tfplan`)
  const plan = await exec([
    'plan',
    '-input=false',
    '-no-color',
    '-lock=false',
    ...(refreshOnly ? ['-refresh-only'] : []),
    ...(mode === 'destroy' ? ['-destroy'] : []),
    `-out=${planFile}`
  ])
  if (!plan.ok) {
    return { ok: false, error: lastLines(plan.out) }
  }
  const shown = await exec(['show', '-json', planFile])
  if (!shown.ok) {
    return { ok: false, error: lastLines(shown.out) }
  }
  const summary = summarizeTerraformPlan(shown.out)
  // Drift checks and empty plans have nothing to price or police.
  let gates: PlanGates | null = null
  if (mode === 'plan' && summary.resources.length > 0) {
    const planJson = `${planFile}.json`
    writeFileSync(planJson, shown.out)
    gates = await runPlanGates(workspacePath, planJson, env)
  }
  return { ok: true, dir: relative, planFile, summary, gates }
}

/** `terraform output -json` as plain strings; read-only, from the same env as plans. */
export async function readTerraformOutputs(
  workspacePath: string,
  dir: string
): Promise<Record<string, string> | { error: string }> {
  const relative = normalize(dir)
  if (isAbsolute(relative) || relative.startsWith('..')) {
    return { error: 'The Terraform directory must be inside the workspace.' }
  }
  const usesMise = MISE_FILES.some((name) => existsSync(join(workspacePath, name)))
  const terraform = await resolveTool(workspacePath, 'terraform', usesMise)
  if (!terraform.available) {
    return { error: terraform.hint }
  }
  const env = {
    ...process.env,
    ...(await workspaceEnv(workspacePath)),
    ...devopsSandboxEnvFor(workspacePath)
  }
  const args = [`-chdir=${relative}`, 'output', '-json', '-no-color']
  return new Promise((resolve) => {
    execFile(
      terraform.runner === 'mise' ? 'mise' : 'terraform',
      terraform.runner === 'mise' ? ['exec', '--', 'terraform', ...args] : args,
      { cwd: workspacePath, env, timeout: 60_000 },
      (error, stdout, stderr) => {
        if (error) {
          resolve({ error: lastLines(String(stderr)) || error.message })
          return
        }
        resolve(parseTerraformOutputs(String(stdout)))
      }
    )
  })
}

function lastLines(text: string): string {
  return text.split('\n').filter(Boolean).slice(-12).join('\n')
}
