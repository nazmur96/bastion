import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { MISE_FILES, resolveTool } from './devops-inspect'
import { workspaceEnv } from './devops-context'
import { devopsSandboxEnvFor } from './devops-sandbox'
import {
  countBudgets,
  parseCallerIdentity,
  usesStaticKeys,
  type CloudReadiness
} from '../../../shared/fork-devops-cloud'

/** Who and where this workspace's aws calls land: identity, region, budgets. Read-only and free. */
export async function readCloudReadiness(
  workspacePath: string
): Promise<CloudReadiness | { error: string }> {
  const usesMise = MISE_FILES.some((name) => existsSync(join(workspacePath, name)))
  const aws = await resolveTool(workspacePath, 'aws', usesMise)
  if (!aws.available) {
    return { error: aws.hint }
  }
  const sandbox = devopsSandboxEnvFor(workspacePath)
  const env: Record<string, string | undefined> = {
    ...process.env,
    ...(await workspaceEnv(workspacePath)),
    ...sandbox
  }
  const call = (args: string[]): Promise<{ ok: boolean; out: string }> =>
    new Promise((resolve) => {
      execFile(
        aws.runner === 'mise' ? 'mise' : 'aws',
        aws.runner === 'mise' ? ['exec', '--', 'aws', ...args] : args,
        { cwd: workspacePath, env, timeout: 20_000 },
        (error, stdout, stderr) =>
          resolve(
            error
              ? { ok: false, out: String(stderr).trim().split('\n').at(-1) || error.message }
              : { ok: true, out: String(stdout) }
          )
      )
    })
  const [identityOut, regionOut, listOut, ssoSession, ssoUrl] = await Promise.all([
    call(['sts', 'get-caller-identity', '--output', 'json']),
    call(['configure', 'get', 'region']),
    call(['configure', 'list']),
    call(['configure', 'get', 'sso_session']),
    call(['configure', 'get', 'sso_start_url'])
  ])
  const profile = env.AWS_PROFILE ?? 'default'
  const sso = Boolean(ssoSession.out.trim() || ssoUrl.out.trim())
  const identity = identityOut.ok ? parseCallerIdentity(identityOut.out) : null
  const region = env.AWS_REGION ?? env.AWS_DEFAULT_REGION ?? (regionOut.out.trim() || null)
  const budgets = identity
    ? countBudgets(
        (
          await call([
            'budgets',
            'describe-budgets',
            '--account-id',
            identity.account,
            '--output',
            'json'
          ])
        ).out
      )
    : null
  return {
    local: Object.keys(sandbox).length > 0,
    profile,
    signIn: sso ? `aws sso login --profile ${profile}` : `aws login --profile ${profile}`,
    region,
    identity: identity ?? { error: identityOut.out || 'Not signed in.' },
    budgets,
    staticKeys: listOut.ok && usesStaticKeys(listOut.out, env)
  }
}
