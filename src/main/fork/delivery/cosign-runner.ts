import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { MISE_FILES, resolveTool } from '../devops/devops-inspect'
import { workspaceEnv } from '../devops/devops-context'
import { readOwnerSource } from '../changes/owner-source-files'
import {
  SUPPLY_CHAIN_POLICY_PATH,
  readSupplyChainEvidence,
  type SupplyChainEvidence
} from './supply-chain-evidence'

/** The project's own Cosign, as the repository pins it; there is no host fallback. */
async function cosign(
  root: string,
  args: string[]
): Promise<{ code: number | null; stderr: string }> {
  const usesMise = MISE_FILES.some((name) => existsSync(join(root, name)))
  const tool = await resolveTool(root, 'cosign', usesMise)
  if (!tool.available || tool.runner !== 'mise') {
    throw new Error('Cosign is not pinned by this project')
  }
  const env = { ...process.env, ...(await workspaceEnv(root)), COSIGN_YES: 'false' }
  return new Promise((resolve) => {
    execFile(
      'mise',
      ['exec', '--', 'cosign', ...args],
      { cwd: root, env, timeout: 60_000, maxBuffer: 4 * 1024 * 1024 },
      (error, _stdout, stderr) =>
        resolve({
          code: error ? (typeof error.code === 'number' ? error.code : null) : 0,
          stderr: String(stderr).slice(-4096)
        })
    )
  })
}

/** Step 14.9 evidence for one project: its policy file and its pinned Cosign. */
export function projectSupplyChain(
  root: string
): (repository: string, digest: string) => Promise<SupplyChainEvidence | null> {
  return (repository, digest) =>
    readSupplyChainEvidence(
      repository,
      digest,
      {
        readPolicy: async () => {
          try {
            return await readOwnerSource(root, SUPPLY_CHAIN_POLICY_PATH)
          } catch (error) {
            // No policy file: not opted in. Any other read failure fails closed.
            return error instanceof Error && 'code' in error && error.code === 'ENOENT' ? null : ''
          }
        },
        verify: (args) => cosign(root, args)
      },
      (path) => join(root, path)
    )
}
