/** Fork, project path stage 3: deploy this repo with Argo CD. */
export type ArgoSourceKind = 'kustomize' | 'helm' | 'directory'

export type ArgoSource = { path: string; kind: ArgoSourceKind }

export type ArgoDeployPlan =
  | {
      ok: true
      /** Argo clones over https; ssh remotes are rewritten. */
      repoURL: string
      branch: string
      /** Commits Argo cannot see yet; null when the branch has no upstream. */
      unpushed: number | null
      sources: ArgoSource[]
      argoInstalled: boolean
      /** This repo's Application is already in Argo CD (the GitOps stage is done). */
      applicationExists: boolean
      name: string
    }
  | { ok: false; error: string }

/** `git@github.com:team/shop.git` → `https://github.com/team/shop.git`; https stays; anything else is null. */
export function httpsRepoUrl(remote: string): string | null {
  const value = remote.trim()
  const scp = /^[\w.-]+@([\w.-]+):(.+)$/.exec(value)
  if (scp) {
    return `https://${scp[1]}/${scp[2]}`
  }
  const ssh = /^ssh:\/\/[\w.-]+@([\w.-]+)(?::\d+)?\/(.+)$/.exec(value)
  if (ssh) {
    return `https://${ssh[1]}/${ssh[2]}`
  }
  return value.startsWith('https://') ? value : null
}

function dirOf(file: string): string {
  const at = file.lastIndexOf('/')
  return at === -1 ? '.' : file.slice(0, at)
}

/** Where a repo's deployable config lives, best first: dev overlays, then any kustomization, charts, plain manifest dirs. */
export function argoSources(
  files: readonly string[],
  manifestDirs: readonly string[]
): ArgoSource[] {
  const kustomize = files
    .filter((file) => /(^|\/)kustomization\.ya?ml$/i.test(file))
    .map((file) => dirOf(file))
  const chartDirs = new Set(
    files.filter((file) => /(^|\/)Chart\.yaml$/.test(file)).map((file) => dirOf(file))
  )
  // A subchart sits in <parent chart>/charts/<name>; only top-level charts are deployable.
  const charts = [...chartDirs].filter((dir) => {
    const match = /^(.*?)\/?charts\/[^/]+$/.exec(dir)
    return !match || !chartDirs.has(match[1] || '.')
  })
  // A base that an overlay builds on is not deployed on its own.
  const score = (path: string): number =>
    (/(^|\/)(dev|local|development)(\/|$)/.test(path) ? 0 : 2) +
    (/(^|\/)base(\/|$)/.test(path) ? 1 : 0)
  const seen = new Set<string>()
  const out: ArgoSource[] = []
  const add = (path: string, kind: ArgoSourceKind): void => {
    if (!seen.has(path)) {
      seen.add(path)
      out.push({ path, kind })
    }
  }
  ;[...kustomize]
    .sort((a, b) => score(a) - score(b) || a.localeCompare(b))
    .forEach((path) => add(path, 'kustomize'))
  charts.forEach((path) => add(path, 'helm'))
  manifestDirs
    .filter((dir) => ![...seen].some((taken) => dir === taken || dir.startsWith(`${taken}/`)))
    .forEach((dir) => add(dir, 'directory'))
  return out
}

/** Kubernetes names: lowercase, digits and dashes, at most 53 so Helm-made children still fit. */
export function argoAppName(repoFolder: string): string {
  const slug = repoFolder
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return (slug || 'app').slice(0, 53)
}

function yamlString(value: string): string {
  return JSON.stringify(value)
}

/** Automated sync with self-heal: after this, Git is the only way in (as the DevSecOps path wants). */
export function argoApplicationYaml(input: {
  name: string
  repoURL: string
  revision: string
  source: ArgoSource
  namespace: string
}): string {
  const { name, repoURL, revision, source, namespace } = input
  return [
    'apiVersion: argoproj.io/v1alpha1',
    'kind: Application',
    'metadata:',
    `  name: ${name}`,
    '  namespace: argocd',
    'spec:',
    '  project: default',
    '  source:',
    `    repoURL: ${yamlString(repoURL)}`,
    `    targetRevision: ${yamlString(revision)}`,
    `    path: ${yamlString(source.path)}`,
    ...(source.kind === 'directory' ? ['    directory:', '      recurse: true'] : []),
    '  destination:',
    '    server: https://kubernetes.default.svc',
    `    namespace: ${namespace}`,
    '  syncPolicy:',
    '    automated:',
    '      prune: true',
    '      selfHeal: true',
    '    syncOptions:',
    '      - CreateNamespace=true',
    ''
  ].join('\n')
}

/**
 * One chain, stopping at the first failure. Argo CD is installed only when it is
 * missing (never upgraded over someone's own), and the admin password is read
 * with a go-template so no `base64` binary is needed (Windows).
 */
export function argoDeploySteps(input: {
  argoInstalled: boolean
  appFile: string
  name: string
}): string[] {
  const quoted = `"${input.appFile}"`
  return [
    ...(input.argoInstalled
      ? []
      : [
          'helm install argocd oci://ghcr.io/argoproj/argo-helm/argo-cd -n argocd --create-namespace --wait --timeout 10m'
        ]),
    'kubectl -n argocd rollout status deploy/argocd-server --timeout=300s',
    `kubectl apply -f ${quoted}`,
    // Synced is the deploy signal. Health can stay Degraded for reasons outside the repo
    // (an HPA on a cluster without metrics-server), so it is reported, not waited on.
    `kubectl -n argocd wait application/${input.name} --for=jsonpath={.status.sync.status}=Synced --timeout=600s`,
    `kubectl -n argocd get application/${input.name} -o go-template='sync: {{.status.sync.status}}  health: {{.status.health.status}}{{println}}{{if ne .status.health.status "Healthy"}}Not Healthy: open the app in Argo CD to see which resource. On kind, an HPA stays Degraded until metrics-server is installed.{{println}}{{end}}'`,
    'kubectl -n argocd get secret argocd-initial-admin-secret -o go-template="admin password: {{.data.password | base64decode}}{{println}}"'
  ]
}

export const ARGO_UI_PORT = 8080
