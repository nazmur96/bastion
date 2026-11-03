/** Fork: which infrastructure stacks a workspace contains, read from its file list. */
export type DevopsStack =
  | 'terraform'
  | 'kubernetes'
  | 'helm'
  | 'argocd'
  | 'aws'
  | 'containers'
  | 'ci'
  | 'secrets'
  | 'ansible'

export type DevopsStackFinding = {
  stack: DevopsStack
  /** A few workspace-relative files that show the stack, for tooltips. */
  evidence: string[]
  /** Directories an action should run in (Terraform roots, Helm charts). */
  dirs: string[]
}

const EVIDENCE_LIMIT = 3

function dirOf(path: string): string {
  const slash = path.lastIndexOf('/')
  return slash === -1 ? '.' : path.slice(0, slash)
}

function baseOf(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

const YAML = /\.ya?ml$/i

export function isYamlPath(path: string): boolean {
  return YAML.test(path)
}

function isManifestHead(head: string): boolean {
  return /^apiVersion:\s*\S/m.test(head) && /^kind:\s*\S/m.test(head)
}

function isArgoHead(head: string): boolean {
  return (
    /^apiVersion:\s*argoproj\.io\//m.test(head) &&
    /^kind:\s*(Application|ApplicationSet)\b/m.test(head)
  )
}

function isAnsibleHead(head: string): boolean {
  return /^\s*-?\s*hosts:\s*\S/m.test(head) && /^\s*(tasks|roles):/m.test(head)
}

function isCiPath(path: string): boolean {
  return /^\.github\/workflows\/[^/]+\.ya?ml$/i.test(path) || baseOf(path) === '.gitlab-ci.yml'
}

/** Files whose first few KB the detector needs; everything else is judged by name. */
export function devopsHeadWanted(path: string): boolean {
  return (isYamlPath(path) && !isCiPath(path)) || path.endsWith('.tf')
}

/**
 * `readHead` returns the start of a file (or null); the caller bounds how many it reads.
 * Stacks come back in a stable order with deduplicated, sorted directories.
 */
export function detectDevopsStacks(
  files: readonly string[],
  readHead: (path: string) => string | null
): DevopsStackFinding[] {
  const found = new Map<DevopsStack, { evidence: string[]; dirs: Set<string> }>()
  const add = (stack: DevopsStack, path: string, dir?: string): void => {
    const entry = found.get(stack) ?? { evidence: [], dirs: new Set<string>() }
    if (entry.evidence.length < EVIDENCE_LIMIT && !entry.evidence.includes(path)) {
      entry.evidence.push(path)
    }
    if (dir !== undefined) {
      entry.dirs.add(dir)
    }
    found.set(stack, entry)
  }
  // Chart templates are Go templates, not manifests: keep them out of Kubernetes and Argo.
  const chartDirs = files.filter((path) => baseOf(path) === 'Chart.yaml').map(dirOf)
  const inChart = (path: string) =>
    chartDirs.some((dir) => dir === '.' || path.startsWith(`${dir}/`))
  for (const path of files) {
    const base = baseOf(path)
    if (path.endsWith('.tf') || path.endsWith('.tfvars') || base === '.terraform.lock.hcl') {
      add('terraform', path, path.endsWith('.tfvars') ? undefined : dirOf(path))
      if (
        path.endsWith('.tf') &&
        /provider\s+"aws"|source\s*=\s*"hashicorp\/aws"/.test(readHead(path) ?? '')
      ) {
        add('aws', path)
      }
    }
    if (base === 'cdk.json' || base === 'samconfig.toml') {
      add('aws', path)
    }
    if (base === 'Chart.yaml') {
      add('helm', path, dirOf(path))
    }
    if (base === 'kustomization.yaml' || base === 'kustomization.yml') {
      add('kubernetes', path, dirOf(path))
    }
    if (
      /^(Dockerfile|Containerfile)(\..+)?$/.test(base) ||
      /^(docker-)?compose(\..+)?\.ya?ml$/.test(base)
    ) {
      add('containers', path)
    }
    if (path.startsWith('.devcontainer/') || base === '.devcontainer.json') {
      add('containers', path)
    }
    if (isCiPath(path)) {
      add('ci', path)
    }
    if (
      base === '.sops.yaml' ||
      /\.enc\.(ya?ml|json|env)$/.test(base) ||
      /^\.env(\..+)?$/.test(base)
    ) {
      add('secrets', path)
    }
    if (base === 'ansible.cfg') {
      add('ansible', path)
    }
    if (
      isYamlPath(path) &&
      !isCiPath(path) &&
      base !== 'Chart.yaml' &&
      !inChart(path) &&
      !path.startsWith('.devcontainer/')
    ) {
      const head = readHead(path)
      if (head && isArgoHead(head)) {
        add('argocd', path)
      }
      if (head && isManifestHead(head)) {
        // Plain manifest folders are deployable too; a folder of Argo Applications is not the app.
        add('kubernetes', path, isArgoHead(head) ? undefined : dirOf(path))
      } else if (head && isAnsibleHead(head)) {
        add('ansible', path)
      }
    }
  }
  return DEVOPS_STACK_ORDER.flatMap((stack) => {
    const entry = found.get(stack)
    return entry ? [{ stack, evidence: entry.evidence, dirs: [...entry.dirs].sort() }] : []
  })
}

/** Display order; also the tie-break when ranking actions. */
export const DEVOPS_STACK_ORDER: readonly DevopsStack[] = [
  'terraform',
  'kubernetes',
  'helm',
  'argocd',
  'aws',
  'containers',
  'ci',
  'ansible',
  'secrets'
]

/** The stack a single file belongs to, for ranking by the open file. */
export function stackOfFile(path: string, head: string | null): DevopsStack | null {
  const base = baseOf(path)
  if (path.endsWith('.tf') || path.endsWith('.tfvars')) {
    return 'terraform'
  }
  if (base === 'Chart.yaml' || /\/templates\/[^/]+\.ya?ml$/.test(path) || base === 'values.yaml') {
    return 'helm'
  }
  if (isCiPath(path)) {
    return 'ci'
  }
  if (/^(Dockerfile|Containerfile)/.test(base) || /compose(\..+)?\.ya?ml$/.test(base)) {
    return 'containers'
  }
  if (isYamlPath(path) && head) {
    if (isArgoHead(head)) {
      return 'argocd'
    }
    if (isManifestHead(head) || /^kustomization\.ya?ml$/.test(base)) {
      return 'kubernetes'
    }
    if (isAnsibleHead(head)) {
      return 'ansible'
    }
  }
  return null
}

/** The focused file's stack without its contents: YAML is placed by the workspace's findings. */
export function stackOfWorkspaceFile(
  path: string,
  findings: readonly DevopsStackFinding[]
): DevopsStack | null {
  const byName = stackOfFile(path, null)
  if (byName || !isYamlPath(path)) {
    return byName
  }
  const has = (stack: DevopsStack) => findings.find((finding) => finding.stack === stack)
  if (has('helm')?.dirs.some((dir) => path.startsWith(`${dir}/`))) {
    return 'helm'
  }
  if (has('argocd')?.evidence.includes(path)) {
    return 'argocd'
  }
  return has('kubernetes') ? 'kubernetes' : null
}
