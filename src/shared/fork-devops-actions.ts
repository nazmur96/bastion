import type { DevopsStack, DevopsStackFinding } from './fork-devops-stacks'
import { DEVOPS_STACK_ORDER } from './fork-devops-stacks'

/** Toolbelt actions only read, plan or prepare; changing infrastructure goes through the gate. */
export type DevopsActionKind = 'setup' | 'read' | 'plan'

export type DevopsActionContext = {
  findings: readonly DevopsStackFinding[]
  /** Workspace-relative path of the focused file, with the stack it belongs to. */
  activeFile?: { path: string; stack: DevopsStack | null }
}

export type DevopsAction = {
  id: string
  stack: DevopsStack
  label: string
  description: string
  /** The CLI the command needs; the tool resolver checks it in the workspace's environment. */
  tool: string
  kind: DevopsActionKind
  /** The shell command, run from the workspace root, or null when it does not apply. */
  command: (context: DevopsActionContext) => string | null
}

function quote(value: string): string {
  return /^[\w./-]+$/.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`
}

function dirsOf(context: DevopsActionContext, stack: DevopsStack): readonly string[] {
  return context.findings.find((finding) => finding.stack === stack)?.dirs ?? []
}

function dirOfFile(path: string): string {
  const slash = path.lastIndexOf('/')
  return slash === -1 ? '.' : path.slice(0, slash)
}

/** The focused file's directory when it belongs to the stack, else the first known one. */
function targetDir(context: DevopsActionContext, stack: DevopsStack): string | null {
  const active = context.activeFile
  if (active?.stack === stack) {
    const dir = dirOfFile(active.path)
    const known = dirsOf(context, stack)
    // A chart's templates/ file runs against its chart root.
    return known.find((candidate) => dir === candidate || dir.startsWith(`${candidate}/`)) ?? dir
  }
  return dirsOf(context, stack)[0] ?? null
}

function terraform(subcommand: string) {
  return (context: DevopsActionContext): string | null => {
    const dir = targetDir(context, 'terraform')
    return dir === null
      ? null
      : `terraform${dir === '.' ? '' : ` -chdir=${quote(dir)}`} ${subcommand}`
  }
}

function activeManifest(context: DevopsActionContext): string | null {
  return context.activeFile?.stack === 'kubernetes' ? context.activeFile.path : null
}

export const DEVOPS_ACTIONS: readonly DevopsAction[] = [
  {
    id: 'terraform.init',
    stack: 'terraform',
    label: 'Init',
    description: 'terraform init: download providers and modules',
    tool: 'terraform',
    kind: 'setup',
    command: terraform('init')
  },
  {
    id: 'terraform.validate',
    stack: 'terraform',
    label: 'Validate',
    description: 'terraform validate: check the configuration',
    tool: 'terraform',
    kind: 'read',
    command: terraform('validate')
  },
  {
    id: 'terraform.fmt',
    stack: 'terraform',
    label: 'Format check',
    description: 'terraform fmt -check: list badly formatted files',
    tool: 'terraform',
    kind: 'read',
    command: terraform('fmt -check -recursive -diff')
  },
  {
    id: 'terraform.plan',
    stack: 'terraform',
    label: 'Plan',
    description: 'terraform plan: preview changes without applying them',
    tool: 'terraform',
    kind: 'plan',
    command: terraform('plan')
  },
  {
    id: 'terraform.drift',
    stack: 'terraform',
    label: 'Drift check',
    description: 'terraform plan -refresh-only: what changed outside Terraform',
    tool: 'terraform',
    kind: 'plan',
    command: terraform('plan -refresh-only')
  },
  {
    id: 'kubernetes.context',
    stack: 'kubernetes',
    label: 'Context',
    description: 'Show the current cluster, user and namespace',
    tool: 'kubectl',
    kind: 'read',
    command: () => 'kubectl config get-contexts "$(kubectl config current-context)"'
  },
  {
    id: 'kubernetes.diff',
    stack: 'kubernetes',
    label: 'Diff file vs cluster',
    description: 'kubectl diff: how the open manifest differs from the live cluster',
    tool: 'kubectl',
    kind: 'plan',
    command: (context) => {
      const file = activeManifest(context)
      return file ? `kubectl diff -f ${quote(file)}` : null
    }
  },
  {
    id: 'kubernetes.pods',
    stack: 'kubernetes',
    label: 'Pods',
    description: 'kubectl get pods in the current namespace',
    tool: 'kubectl',
    kind: 'read',
    command: () => 'kubectl get pods -o wide'
  },
  {
    id: 'kubernetes.events',
    stack: 'kubernetes',
    label: 'Events',
    description: 'Recent events, newest last',
    tool: 'kubectl',
    kind: 'read',
    command: () => 'kubectl get events --sort-by=.lastTimestamp'
  },
  {
    id: 'kubernetes.kustomize',
    stack: 'kubernetes',
    label: 'Render kustomize',
    description: 'kubectl kustomize: the manifests this overlay produces',
    tool: 'kubectl',
    kind: 'read',
    command: (context) => {
      const dirs = dirsOf(context, 'kubernetes')
      const active = context.activeFile?.path
      // The overlay holding the open file, else the first one.
      const dir = dirs.find((candidate) => active?.startsWith(`${candidate}/`)) ?? dirs[0]
      return dir ? `kubectl kustomize ${quote(dir)}` : null
    }
  },
  {
    id: 'helm.lint',
    stack: 'helm',
    label: 'Lint chart',
    description: 'helm lint: check the chart for problems',
    tool: 'helm',
    kind: 'read',
    command: (context) => {
      const dir = targetDir(context, 'helm')
      return dir ? `helm lint ${quote(dir)}` : null
    }
  },
  {
    id: 'helm.template',
    stack: 'helm',
    label: 'Render chart',
    description: 'helm template: the manifests this chart produces',
    tool: 'helm',
    kind: 'read',
    command: (context) => {
      const dir = targetDir(context, 'helm')
      return dir ? `helm template ${quote(dir)}` : null
    }
  },
  {
    id: 'argocd.apps',
    stack: 'argocd',
    label: 'Argo apps',
    description: 'argocd app list: sync and health of every app',
    tool: 'argocd',
    kind: 'read',
    command: () => 'argocd app list'
  },
  {
    id: 'aws.whoami',
    stack: 'aws',
    label: 'Who am I',
    description: 'aws sts get-caller-identity: the account and role in use',
    tool: 'aws',
    kind: 'read',
    command: () => 'aws sts get-caller-identity'
  },
  {
    id: 'containers.compose',
    stack: 'containers',
    label: 'Compose config',
    description: 'The resolved compose file',
    tool: 'docker',
    kind: 'read',
    command: (context) =>
      context.findings
        .find((finding) => finding.stack === 'containers')
        ?.evidence.some((path) => /compose(\..+)?\.ya?ml$/.test(path))
        ? 'docker compose config'
        : null
  },
  {
    id: 'containers.ps',
    stack: 'containers',
    label: 'Containers',
    description: 'Running containers',
    tool: 'docker',
    kind: 'read',
    command: () => 'docker ps'
  },
  {
    id: 'ci.runs',
    stack: 'ci',
    label: 'CI runs',
    description: 'Recent GitHub Actions runs for this branch',
    tool: 'gh',
    kind: 'read',
    command: () => 'gh run list --branch "$(git branch --show-current)" --limit 10'
  },
  {
    id: 'ci.failed',
    stack: 'ci',
    label: 'Failed CI logs',
    description: 'Logs of the failed steps in the latest run',
    tool: 'gh',
    kind: 'read',
    command: () =>
      'gh run view "$(gh run list --branch "$(git branch --show-current)" --limit 1 --json databaseId --jq ".[0].databaseId")" --log-failed'
  },
  {
    id: 'ansible.lint',
    stack: 'ansible',
    label: 'Lint',
    description: 'ansible-lint: check playbooks and roles',
    tool: 'ansible-lint',
    kind: 'read',
    command: () => 'ansible-lint'
  }
]

export type RankedDevopsAction = { action: DevopsAction; command: string }

/** Actions that apply here, the focused file's stack first, then the spec's stack order. */
export function rankDevopsActions(context: DevopsActionContext): RankedDevopsAction[] {
  const present = new Set(context.findings.map((finding) => finding.stack))
  const focused = context.activeFile?.stack ?? null
  const ranked: (RankedDevopsAction & { score: number })[] = []
  DEVOPS_ACTIONS.forEach((action, index) => {
    if (!present.has(action.stack)) {
      return
    }
    const command = action.command(context)
    if (!command) {
      return
    }
    const stackRank = DEVOPS_STACK_ORDER.indexOf(action.stack)
    const score = (action.stack === focused ? 0 : 1000) + stackRank * 100 + index
    ranked.push({ action, command, score })
  })
  return ranked
    .sort((a, b) => a.score - b.score)
    .map(({ action, command }) => ({ action, command }))
}
