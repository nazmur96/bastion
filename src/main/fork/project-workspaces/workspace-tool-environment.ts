import { mkdirSync, closeSync, openSync } from 'node:fs'
import { join } from 'node:path'

const CREDENTIAL_KEYS = [
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'AWS_SECURITY_TOKEN',
  'AWS_WEB_IDENTITY_TOKEN_FILE',
  'AWS_ROLE_ARN',
  'AWS_CONTAINER_CREDENTIALS_RELATIVE_URI',
  'AWS_CONTAINER_CREDENTIALS_FULL_URI',
  'AWS_CONTAINER_AUTHORIZATION_TOKEN',
  'AWS_DEFAULT_PROFILE',
  'AWS_REGION',
  'AWS_DEFAULT_REGION',
  'AWS_ENDPOINT_URL',
  'GOOGLE_APPLICATION_CREDENTIALS',
  'GOOGLE_CLOUD_PROJECT',
  'CLOUDSDK_CORE_PROJECT',
  'CLOUDSDK_AUTH_ACCESS_TOKEN',
  'AZURE_CLIENT_SECRET',
  'AZURE_CLIENT_ID',
  'AZURE_TENANT_ID',
  'ARM_CLIENT_SECRET',
  'ARM_CLIENT_ID',
  'ARM_TENANT_ID',
  'ARM_SUBSCRIPTION_ID',
  'ARM_USE_MSI',
  'ARM_USE_OIDC',
  'ARM_OIDC_TOKEN',
  'KUBE_TOKEN',
  'KUBE_HOST',
  'KUBE_CONFIG_PATH',
  'KUBE_CONFIG_PATHS',
  'KUBE_CTX',
  'TF_WORKSPACE'
] as const

/** Private, unconfigured defaults. Explicit project/runtime configuration may override these. */
export function projectWorkspaceToolEnvironment(
  inherited: NodeJS.ProcessEnv = process.env
): NodeJS.ProcessEnv {
  const root = inherited.BASTION_PROJECT_WORKSPACE_DATA_ROOT
  if (!root) {
    return { ...inherited }
  }
  const env = { ...inherited }
  for (const key of CREDENTIAL_KEYS) {
    delete env[key]
  }
  const directory = join(root, 'tool-context')
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const empty = (name: string): string => {
    const path = join(directory, name)
    closeSync(openSync(path, 'a', 0o600))
    return path
  }
  return {
    ...env,
    AWS_PROFILE: 'workspace-unconfigured',
    AWS_CONFIG_FILE: empty('aws-config'),
    AWS_SHARED_CREDENTIALS_FILE: empty('aws-credentials'),
    AWS_EC2_METADATA_DISABLED: 'true',
    KUBECONFIG: empty('kubeconfig'),
    AZURE_CONFIG_DIR: join(directory, 'azure'),
    CLOUDSDK_CONFIG: join(directory, 'gcloud')
  }
}

/** Carry defaults and removals to persistent daemons, whose ambient environment may predate this app. */
export function projectWorkspaceSpawnOverrides(explicitEnv: Record<string, string> | undefined): {
  env: Record<string, string> | undefined
  envToDelete: string[]
} {
  const root = process.env.BASTION_PROJECT_WORKSPACE_DATA_ROOT
  if (!root) {
    return { env: explicitEnv, envToDelete: [] }
  }
  const defaults = projectWorkspaceToolEnvironment({ BASTION_PROJECT_WORKSPACE_DATA_ROOT: root })
  const env = Object.fromEntries(
    Object.entries(defaults).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string'
    )
  )
  return {
    env: { ...env, ...explicitEnv },
    envToDelete: CREDENTIAL_KEYS.filter((key) => explicitEnv?.[key] === undefined)
  }
}
