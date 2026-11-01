import type { PermissionMode, PermissionResult } from '@anthropic-ai/claude-agent-sdk'
import type { ClaudePendingPrompt } from './claude-prompt-registry'
import type { ClaudeSession } from './structured/claude-structured-session-state'
import { readClaudeReportedPermissionMode } from './structured/claude-structured-init-proof'

/** This process's requested mode, else its first init's; anything else asks for each edit. */
export function claudePlanApprovalMode(
  session: Pick<ClaudeSession, 'launchIntent' | 'firstRootInit'>
): PermissionMode {
  // Fork: a chat the person started in Plan builds the approved plan with edits accepted, as Claude's CLI offers.
  if (session.launchIntent?.permissionMode === 'plan') {
    return 'acceptEdits'
  }
  const mode =
    session.launchIntent?.permissionMode ?? session.firstRootInit?.permissionMode ?? 'default'
  switch (mode) {
    case 'default':
    case 'acceptEdits':
    case 'dontAsk':
    case 'auto':
    case 'bypassPermissions':
      return mode
    default:
      return 'default'
  }
}

function logPlanExitFailure(error: unknown): void {
  try {
    console.warn('[claude] leaving Plan mode after an approved plan failed:', error)
  } catch {
    // The approval stands whatever happens to this log line.
  }
}

/** Claude stays in plan after an approved ExitPlanMode until told. The request is written
 *  before the allow and never awaited, so its failure cannot hold or reject the approval. */
export function leaveClaudePlanModeOnApproval(
  session: Pick<ClaudeSession, 'launchIntent' | 'firstRootInit' | 'reportedOptions'> & {
    connection: Pick<ClaudeSession['connection'], 'setPermissionMode'>
  },
  prompt: Pick<ClaudePendingPrompt, 'toolName'>,
  reply: PermissionResult
): void {
  if (
    prompt.toolName !== 'ExitPlanMode' ||
    reply.behavior !== 'allow' ||
    session.reportedOptions.reportedPermissionMode !== 'plan'
  ) {
    return
  }
  const mode = claudePlanApprovalMode(session)
  try {
    session.connection
      .setPermissionMode(mode)
      .then(() => {
        // Fork: Claude sends no status frame for this switch, so record it as one; the turn's result
        // then publishes it and the mode picker stops showing Plan.
        const reported = readClaudeReportedPermissionMode({
          type: 'system',
          subtype: 'status',
          permissionMode: mode
        })
        if (reported !== undefined) {
          session.reportedOptions.reportedPermissionMode = reported
        }
      })
      .catch(logPlanExitFailure)
  } catch (error) {
    logPlanExitFailure(error)
  }
}
