/** Fork A2: what an infrastructure command Claude wants to run would do. */
export type InfraCommandClass = 'safe' | 'change' | 'destroy' | 'apply-unplanned'

export type InfraCommandTarget = 'cloud' | 'cluster'

export type InfraCommandVerdict = {
  class: InfraCommandClass
  target: InfraCommandTarget
  /** The part of the command line that decided it, for the approval card. */
  command: string
}

const SPLIT = /\s*(?:&&|\|\||;|\||\n)\s*/

function words(segment: string): string[] {
  return segment.match(/'[^']*'|"[^"]*"|\S+/g) ?? []
}

function unquote(word: string): string {
  return /^(['"]).*\1$/.test(word) ? word.slice(1, -1) : word
}

/** Strip env assignments and wrappers (`mise exec --`, `sudo`, `time`, `env`); `sh -c '…'` recurses. */
function commandsOf(line: string): string[][] {
  const out: string[][] = []
  for (const segment of line.split(SPLIT)) {
    let argv = words(segment)
    for (;;) {
      if (argv[0] && /^[A-Za-z_][A-Za-z0-9_]*=/.test(argv[0])) {
        argv = argv.slice(1)
      } else if (
        argv[0] === 'sudo' ||
        argv[0] === 'time' ||
        argv[0] === 'env' ||
        argv[0] === 'command'
      ) {
        argv = argv.slice(1)
      } else if (argv[0] === 'mise' && argv[1] === 'exec') {
        const dash = argv.indexOf('--')
        argv = dash === -1 ? argv.slice(2) : argv.slice(dash + 1)
      } else if (
        (argv[0] === 'sh' || argv[0] === 'bash' || argv[0] === 'zsh') &&
        argv[1] === '-c'
      ) {
        out.push(...commandsOf(unquote(argv.slice(2).join(' '))))
        argv = []
      } else {
        break
      }
    }
    if (argv.length > 0) {
      out.push(argv.map(unquote))
    }
  }
  return out
}

function positional(args: readonly string[]): string[] {
  return args.filter((arg) => !arg.startsWith('-'))
}

function terraform(args: readonly string[]): InfraCommandClass {
  const [sub, ...rest] = positional(args.filter((arg) => !arg.startsWith('-chdir')))
  if (sub === 'destroy' || (sub === 'apply' && rest.length === 0 && args.includes('-destroy'))) {
    return 'destroy'
  }
  if (sub === 'apply') {
    // A saved plan file is the reviewed change; anything else would plan and apply in one go.
    return rest.length > 0 ? 'change' : 'apply-unplanned'
  }
  if (
    sub === 'import' ||
    sub === 'taint' ||
    (sub === 'state' && /^(rm|mv|push|replace-provider)$/.test(rest[0] ?? ''))
  ) {
    return 'change'
  }
  return 'safe'
}

const KUBE_DESTROY = new Set(['delete', 'drain'])
const KUBE_CHANGE = new Set([
  'apply',
  'create',
  'replace',
  'patch',
  'scale',
  'autoscale',
  'set',
  'label',
  'annotate',
  'edit',
  'cordon',
  'uncordon',
  'taint',
  'expose',
  'run'
])

function kubectl(args: readonly string[]): InfraCommandClass {
  const [sub, next] = positional(args)
  if (KUBE_DESTROY.has(sub ?? '')) {
    return 'destroy'
  }
  if (
    KUBE_CHANGE.has(sub ?? '') ||
    (sub === 'rollout' && /^(restart|undo|pause|resume)$/.test(next ?? ''))
  ) {
    return 'change'
  }
  return 'safe'
}

function helm(args: readonly string[]): InfraCommandClass {
  const [sub] = positional(args)
  if (sub === 'uninstall' || sub === 'delete') {
    return 'destroy'
  }
  return sub === 'install' || sub === 'upgrade' || sub === 'rollback' ? 'change' : 'safe'
}

function aws(args: readonly string[]): InfraCommandClass {
  const [service, action] = positional(args)
  if (service === 's3') {
    if (action === 'rm' || action === 'rb') {
      return 'destroy'
    }
    return action === 'cp' || action === 'mv' || action === 'sync' || action === 'mb'
      ? 'change'
      : 'safe'
  }
  if (
    !action ||
    /^(describe|list|get|head|wait|help)\b/.test(action) ||
    service === 'sts' ||
    service === 'configure' ||
    service === 'sso' ||
    service === 'login'
  ) {
    return 'safe'
  }
  if (
    /^(delete|terminate|remove|deregister|purge|cancel|disable|stop|detach|disassociate|revoke)-/.test(
      action
    )
  ) {
    return 'destroy'
  }
  return 'change'
}

function argocd(args: readonly string[]): InfraCommandClass {
  const [noun, verb] = positional(args)
  if (noun === 'app' && verb === 'delete') {
    return 'destroy'
  }
  return noun === 'app' && /^(sync|rollback|set|patch|create)$/.test(verb ?? '') ? 'change' : 'safe'
}

function iac(args: readonly string[], create: string, destroy: string): InfraCommandClass {
  const [sub] = positional(args)
  return sub === destroy ? 'destroy' : sub === create ? 'change' : 'safe'
}

const RANK: Record<InfraCommandClass, number> = {
  safe: 0,
  change: 1,
  destroy: 2,
  'apply-unplanned': 3
}

/** The riskiest infrastructure step in a command line; `safe` for everything else. */
export function classifyInfraCommand(line: string): InfraCommandVerdict {
  let worst: InfraCommandVerdict = { class: 'safe', target: 'cloud', command: '' }
  for (const [tool, ...args] of commandsOf(line)) {
    const name = tool?.split('/').at(-1) ?? ''
    const verdict: InfraCommandVerdict | null =
      name === 'terraform' || name === 'tofu'
        ? { class: terraform(args), target: 'cloud', command: '' }
        : name === 'aws'
          ? { class: aws(args), target: 'cloud', command: '' }
          : name === 'pulumi'
            ? { class: iac(args, 'up', 'destroy'), target: 'cloud', command: '' }
            : name === 'eksctl'
              ? { class: iac(args, 'create', 'delete'), target: 'cloud', command: '' }
              : name === 'kubectl' || name === 'oc'
                ? { class: kubectl(args), target: 'cluster', command: '' }
                : name === 'helm'
                  ? { class: helm(args), target: 'cluster', command: '' }
                  : name === 'argocd'
                    ? { class: argocd(args), target: 'cluster', command: '' }
                    : null
    if (verdict && RANK[verdict.class] > RANK[worst.class]) {
      worst = { ...verdict, command: [name, ...args].join(' ') }
    }
  }
  return worst
}

export type InfraGateDecision = { decision: 'ask' | 'deny'; reason: string } | null

/** Local sandboxes run free; real infrastructure needs a person, and an apply needs a reviewed plan. */
export function infraGateDecision(
  verdict: InfraCommandVerdict,
  tone: 'local' | 'prod' | 'normal',
  where: string
): InfraGateDecision {
  if (verdict.class === 'safe' || tone === 'local') {
    return null
  }
  const prefix = tone === 'prod' ? 'PRODUCTION · ' : ''
  if (verdict.class === 'apply-unplanned') {
    return {
      decision: 'deny',
      reason: `${prefix}Orca's safety gate: plan first. Run \`terraform plan -out=tfplan\`, show the person the plan, and after they approve run \`terraform apply tfplan\` (${where}).`
    }
  }
  return {
    decision: 'ask',
    reason: `${prefix}${verdict.class === 'destroy' ? 'Destroys' : 'Changes'} real infrastructure (${where}): ${verdict.command}`
  }
}
