import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { MISE_FILES, resolveTool, run } from './devops-inspect'
import { parseTrivyConfig, type ScanResult } from '../../../shared/fork-devops-scan'

const SCAN_TIMEOUT_MS = 5 * 60_000

/** Trivy's misconfiguration scan over the repo, read-only; findings keep their file and lines. */
export async function runRepoScan(workspacePath: string): Promise<ScanResult> {
  const usesMise = MISE_FILES.some((name) => existsSync(join(workspacePath, name)))
  const trivy = await resolveTool(workspacePath, 'trivy', usesMise)
  if (!trivy.available) {
    return { ok: false, error: trivy.hint }
  }
  const args = ['config', '--format', 'json', '--quiet', '--exit-code', '0', '.']
  const result =
    trivy.runner === 'mise'
      ? await run('mise', ['exec', '--', 'trivy', ...args], workspacePath, SCAN_TIMEOUT_MS)
      : await run('trivy', args, workspacePath, SCAN_TIMEOUT_MS)
  if (!result.ok) {
    return {
      ok: false,
      error: result.stdout.trim().split('\n').slice(-3).join('\n') || 'trivy failed'
    }
  }
  return { ok: true, findings: parseTrivyConfig(result.stdout) }
}
