import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { MISE_FILES, resolveTool } from './devops-inspect'
import {
  parseCheckovSummary,
  parseInfracostMonthly,
  type PlanGate,
  type PlanGates
} from '../../../shared/fork-terraform-plan'

const GATE_TIMEOUT_MS = 3 * 60_000

async function runTool(
  workspacePath: string,
  tool: string,
  args: string[],
  env: NodeJS.ProcessEnv
): Promise<{ ok: boolean; out: string } | null> {
  const usesMise = MISE_FILES.some((name) => existsSync(join(workspacePath, name)))
  const status = await resolveTool(workspacePath, tool, usesMise)
  if (!status.available) {
    return null
  }
  return new Promise((resolve) => {
    execFile(
      status.runner === 'mise' ? 'mise' : tool,
      status.runner === 'mise' ? ['exec', '--', tool, ...args] : args,
      { cwd: workspacePath, env, timeout: GATE_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024 },
      (error, stdout, stderr) =>
        resolve({
          ok: !error,
          out: error ? String(stderr).trim().split('\n').at(-1) || error.message : String(stdout)
        })
    )
  })
}

function gate<T>(
  result: { ok: boolean; out: string } | null,
  tool: string,
  parse: (stdout: string) => T | null
): PlanGate<T> {
  if (!result) {
    return { ok: false, reason: `${tool} is not installed for this repo` }
  }
  const value = result.ok ? parse(result.out) : null
  return value === null
    ? { ok: false, reason: result.out.slice(0, 200) || `${tool} gave no result` }
    : { ok: true, value }
}

/** Cost and policy for a plan's JSON, before anyone decides to apply it. Both are read-only. */
export async function runPlanGates(
  workspacePath: string,
  planJson: string,
  env: NodeJS.ProcessEnv
): Promise<PlanGates> {
  const [cost, policy] = await Promise.all([
    runTool(
      workspacePath,
      'infracost',
      ['breakdown', '--path', planJson, '--format', 'json', '--no-color'],
      env
    ),
    runTool(
      workspacePath,
      'checkov',
      ['-f', planJson, '--framework', 'terraform_plan', '-o', 'json', '--soft-fail', '--quiet'],
      env
    )
  ])
  return {
    cost: gate(cost, 'infracost', parseInfracostMonthly),
    policy: gate(policy, 'checkov', parseCheckovSummary)
  }
}
