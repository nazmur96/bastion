import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

const userData = mkdtempSync(join(tmpdir(), 'orca-gate-'))
vi.mock('electron', () => ({ app: { getPath: () => userData } }))

import { withDevopsGateHooks } from './devops-command-gate-hook'

async function decide(command: string): Promise<unknown> {
  const { hooks } = withDevopsGateHooks({}, userData)
  const hook = hooks.PreToolUse?.at(-1)?.hooks[0]
  if (!hook) {
    throw new Error('gate hook missing')
  }
  return hook(
    {
      hook_event_name: 'PreToolUse',
      session_id: 's',
      transcript_path: '',
      cwd: userData,
      tool_name: 'Bash',
      tool_input: { command },
      tool_use_id: 't'
    },
    't',
    { signal: new AbortController().signal }
  )
}

describe('the infra gate hook', () => {
  it('asks the person before Claude destroys real cloud resources', async () => {
    expect(await decide('aws ec2 terminate-instances --instance-ids i-0 --dry-run')).toMatchObject({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'ask',
        permissionDecisionReason: expect.stringContaining('Destroys real infrastructure')
      }
    })
  })

  it('refuses an unreviewed terraform apply and lets reads through', async () => {
    expect(await decide('terraform apply -auto-approve')).toMatchObject({
      hookSpecificOutput: { permissionDecision: 'deny' }
    })
    expect(await decide('aws sts get-caller-identity')).toEqual({})
    expect(await decide('ls -la')).toEqual({})
  })
})
