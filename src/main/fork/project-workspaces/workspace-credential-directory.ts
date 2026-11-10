import { homedir } from 'node:os'
import { join } from 'node:path'

/** Integration sign-ins belong to their workspace; Existing projects keeps the original ~/.orca. */
export function integrationCredentialDirectory(env: NodeJS.ProcessEnv = process.env): string {
  const root = env.BASTION_PROJECT_WORKSPACE_DATA_ROOT
  return root ? join(root, 'integration-credentials') : join(homedir(), '.orca')
}
