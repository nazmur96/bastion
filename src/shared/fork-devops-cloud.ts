/** Fork, path stage 5: who and where in AWS, before anything is planned. All read-only. */
export type CloudReadiness = {
  /** Floci is on for this workspace: every call goes to the local emulator. */
  local: boolean
  profile: string
  region: string | null
  identity: { account: string; arn: string } | { error: string }
  /** Budgets in the account; null when they could not be read. */
  budgets: number | null
  /** Long-lived access keys (no session token): works, but keyless SSO is safer. */
  staticKeys: boolean
  /** How this profile signs in: `aws sso login` or `aws login`. */
  signIn: string
}

/** `aws configure list` → whether the access key comes from a static source without a session. */
export function usesStaticKeys(
  configureList: string,
  env: Record<string, string | undefined>
): boolean {
  if (env.AWS_SESSION_TOKEN) {
    return false
  }
  const row = configureList.split('\n').find((line) => /^\s*access_key\s/.test(line))
  if (!row || /<not set>/.test(row)) {
    return false
  }
  return /\b(shared-credentials-file|env)\b/.test(row)
}

export function parseCallerIdentity(stdout: string): { account: string; arn: string } | null {
  try {
    const value: unknown = JSON.parse(stdout)
    const account: unknown =
      value && typeof value === 'object' ? Reflect.get(value, 'Account') : null
    const arn: unknown = value && typeof value === 'object' ? Reflect.get(value, 'Arn') : null
    return typeof account === 'string' && typeof arn === 'string' ? { account, arn } : null
  } catch {
    return null
  }
}

export function countBudgets(stdout: string): number | null {
  try {
    const value: unknown = JSON.parse(stdout)
    const budgets: unknown =
      value && typeof value === 'object' ? Reflect.get(value, 'Budgets') : null
    return Array.isArray(budgets) ? budgets.length : null
  } catch {
    return null
  }
}

/** The prompt that has Claude write the platform, reviewed as pending edits; nothing is applied. */
export function scaffoldPlatformPrompt(input: {
  folder: string
  region: string
  appName: string
}): string {
  return [
    `Write the Terraform for a dev EKS environment for "${input.appName}" in ${input.folder}/envs/dev, region ${input.region}.`,
    '- Use terraform-aws-modules/vpc/aws and terraform-aws-modules/eks/aws with pinned versions; one managed node group of 2 small nodes.',
    '- Remote state in S3 with use_lockfile = true (no DynamoDB); a separate tiny bootstrap for the state bucket if none exists.',
    '- A monthly AWS budget with an email alert, created first.',
    '- Outputs: cluster_name, region, kubeconfig command.',
    '- Tag everything with project and env; no access keys anywhere; provider credentials come from the environment.',
    '- Pin tools in that repo’s mise.toml (terraform, aws-cli).',
    'Write the files only. Do not run terraform init, plan or apply.'
  ].join('\n')
}
