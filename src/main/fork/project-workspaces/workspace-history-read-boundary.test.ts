import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { it, expect, vi } from 'vitest'
import { readAiVaultSessionTitlesFromFiles } from '../../ai-vault/session-title-file-reader'
it('rejects a title read from another workspace', async () => {
  const owner = mkdtempSync(join(tmpdir(), 'bastion-review-owner-'))
  const foreign = mkdtempSync(join(tmpdir(), 'bastion-review-foreign-'))
  try {
    const file = join(foreign, 'review-session.jsonl')
    writeFileSync(
      file,
      [
        {
          type: 'user',
          sessionId: 'review-session',
          timestamp: '2026-11-10T10:00:00.000Z',
          cwd: foreign,
          message: { role: 'user', content: 'Foreign synthetic transcript' }
        },
        {
          type: 'custom-title',
          sessionId: 'review-session',
          customTitle: 'Foreign synthetic title'
        }
      ]
        .map((row) => JSON.stringify(row))
        .concat('')
        .join('\n')
    )
    vi.stubEnv('BASTION_PROJECT_WORKSPACE_DATA_ROOT', owner)
    expect(
      await readAiVaultSessionTitlesFromFiles([
        { agent: 'claude', sessionId: 'review-session', transcriptPath: file }
      ])
    ).toEqual({ titles: [] })
  } finally {
    vi.unstubAllEnvs()
    rmSync(owner, { recursive: true, force: true })
    rmSync(foreign, { recursive: true, force: true })
  }
})
