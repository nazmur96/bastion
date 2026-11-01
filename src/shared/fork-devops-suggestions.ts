import type { RankedDevopsAction } from './fork-devops-actions'

/** What a reply has to say for an action to be offered under it. */
const MENTIONS: readonly { actionId: string; pattern: RegExp }[] = [
  { actionId: 'terraform.plan', pattern: /\bterraform plan\b(?! -refresh-only)/i },
  { actionId: 'terraform.drift', pattern: /\bdrift(ed)?\b|\brefresh-only\b/i },
  { actionId: 'terraform.init', pattern: /\bterraform init\b/i },
  { actionId: 'terraform.validate', pattern: /\bterraform validate\b/i },
  { actionId: 'terraform.fmt', pattern: /\bterraform fmt\b/i },
  { actionId: 'kubernetes.diff', pattern: /\bkubectl diff\b|\bdiff (it )?against the cluster\b/i },
  {
    actionId: 'kubernetes.pods',
    pattern:
      /\bCrashLoopBackOff\b|\bImagePullBackOff\b|\bpods?\b[^.\n]{0,40}\b(crash\w*|pending|failing|restart\w*|not ready)\b/i
  },
  {
    actionId: 'kubernetes.events',
    pattern: /\b(cluster|kubernetes|pod) events\b|\bkubectl get events\b/i
  },
  { actionId: 'kubernetes.context', pattern: /\b(kube ?context|current context|wrong cluster)\b/i },
  { actionId: 'helm.lint', pattern: /\bhelm lint\b/i },
  { actionId: 'helm.template', pattern: /\bhelm template\b|\brender(ed)? the chart\b/i },
  {
    actionId: 'argocd.apps',
    pattern: /\bargo ?cd\b[^.\n]{0,40}\b(sync|health|out of sync|degraded)\b/i
  },
  {
    actionId: 'aws.whoami',
    pattern:
      /\bget-caller-identity\b|\b(which|what) (aws )?account\b|\baws (credentials|identity)\b/i
  },
  {
    actionId: 'ci.failed',
    pattern:
      /\b(ci|workflow|github actions?|pipeline|check)s?\b[^.\n]{0,40}\b(fail\w*|red|broken)\b/i
  },
  { actionId: 'ansible.lint', pattern: /\bansible-lint\b/i }
]

const MAX_CHIPS = 3

/** Actions a reply points at, in the reply's own order, only from what this workspace offers. */
export function devopsSuggestionsForText(
  text: string,
  available: readonly RankedDevopsAction[]
): RankedDevopsAction[] {
  const byId = new Map(available.map((item) => [item.action.id, item]))
  return MENTIONS.map(({ actionId, pattern }) => ({ actionId, index: text.search(pattern) }))
    .filter(({ actionId, index }) => index !== -1 && byId.has(actionId))
    .sort((a, b) => a.index - b.index)
    .slice(0, MAX_CHIPS)
    .flatMap(({ actionId }) => {
      const item = byId.get(actionId)
      return item ? [item] : []
    })
}
