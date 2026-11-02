import type { HookCallbackMatcher, HookEvent } from '@anthropic-ai/claude-agent-sdk'
import { classifyInfraCommand, infraGateDecision } from '../../../shared/fork-devops-command-gate'
import { readDevopsContext } from './devops-context'

type SdkHooks = Partial<Record<HookEvent, HookCallbackMatcher[]>>

function commandOf(input: unknown): string | null {
  const command: unknown = input && typeof input === 'object' ? Reflect.get(input, 'command') : null
  return typeof command === 'string' ? command : null
}

/** A2: Claude's infrastructure commands against real targets go through the person first. */
export function withDevopsGateHooks(existing: SdkHooks, cwd: string): { hooks: SdkHooks } {
  const gate: HookCallbackMatcher = {
    matcher: 'Bash',
    hooks: [
      async (input) => {
        if (input.hook_event_name !== 'PreToolUse') {
          return {}
        }
        const command = commandOf(input.tool_input)
        const verdict = command ? classifyInfraCommand(command) : null
        if (!verdict || verdict.class === 'safe') {
          return {}
        }
        const context = await readDevopsContext(cwd, null)
        const where =
          verdict.target === 'cluster'
            ? context.kube
              ? { tone: context.kube.tone, label: `kube ${context.kube.context}` }
              : { tone: 'normal' as const, label: 'kube: unknown context' }
            : context.aws
              ? { tone: context.aws.tone, label: `aws ${context.aws.profile}` }
              : { tone: 'normal' as const, label: 'aws: unknown profile' }
        const decision = infraGateDecision(verdict, where.tone, where.label)
        return decision
          ? {
              hookSpecificOutput: {
                hookEventName: 'PreToolUse',
                permissionDecision: decision.decision,
                permissionDecisionReason: decision.reason
              }
            }
          : {}
      }
    ]
  }
  return { hooks: { ...existing, PreToolUse: [...(existing.PreToolUse ?? []), gate] } }
}
