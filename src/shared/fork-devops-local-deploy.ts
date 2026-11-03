import { parseAllDocuments } from 'yaml'
import type { ArgoSource } from './fork-devops-argo-deploy'

/** Fork, path stage 2: build this app, load it into the local cluster, deploy its own manifests. */
export type ImageTarget = {
  kind: 'Deployment' | 'StatefulSet' | 'DaemonSet'
  name: string
  namespace: string | null
  container: string
  image: string
}

export type LocalCluster = { tool: 'kind' | 'k3d'; name: string }

export type LocalDeployPlan =
  | {
      ok: true
      image: string
      dockerfile: string
      runtime: 'docker' | 'podman'
      cluster: LocalCluster
      source: ArgoSource
      /** Where the manifests live: the app repo or a confirmed GitOps sibling. */
      manifestsPath: string
      namespace: string
      targets: ImageTarget[]
      /** Absolute, resolved by the main process for this OS. */
      paths: { dockerContext: string; dockerfile: string; source: string; archive: string }
    }
  | { ok: false; error: string }

const WORKLOADS = new Set(['Deployment', 'StatefulSet', 'DaemonSet'])

function isWorkload(kind: unknown): kind is ImageTarget['kind'] {
  return typeof kind === 'string' && WORKLOADS.has(kind)
}

/** A nested field, or undefined when any step is not an object. */
function at(value: unknown, ...keys: string[]): unknown {
  let current = value
  for (const key of keys) {
    if (current === null || typeof current !== 'object') {
      return undefined
    }
    current = Reflect.get(current, key)
  }
  return current
}

/** `ghcr.io/team/shop-api:1.2@sha256:…` → `shop-api`. */
export function imageRepoName(image: string): string {
  const last = image.split('@')[0].split('/').at(-1) ?? image
  return last.split(':')[0].toLowerCase()
}

/** Which containers run this app's image, in rendered manifests (multi-document YAML). */
export function imageTargets(rendered: string, appName: string): ImageTarget[] {
  const all: ImageTarget[] = []
  for (const doc of parseAllDocuments(rendered)) {
    const value: unknown = doc.toJS()
    const kind = at(value, 'kind')
    if (!isWorkload(kind)) {
      continue
    }
    const name = at(value, 'metadata', 'name')
    const namespace = at(value, 'metadata', 'namespace')
    const containers = at(value, 'spec', 'template', 'spec', 'containers')
    if (typeof name !== 'string' || !Array.isArray(containers)) {
      continue
    }
    for (const container of containers) {
      const containerName = at(container, 'name')
      const image = at(container, 'image')
      if (typeof containerName === 'string' && typeof image === 'string') {
        all.push({
          kind,
          name,
          namespace: typeof namespace === 'string' ? namespace : null,
          container: containerName,
          image
        })
      }
    }
  }
  const app = appName.toLowerCase()
  const matching = all.filter((target) => imageRepoName(target.image) === app)
  // One workload and no name match: it is still clearly the app.
  return matching.length > 0 ? matching : all.length === 1 ? all : []
}

/** `kind-shop-dev` → kind cluster `shop-dev`; `k3d-shop-dev` → k3d. Others cannot take a local image this way. */
export function localClusterOf(context: string): LocalCluster | null {
  const kind = /^kind-(.+)$/.exec(context)
  if (kind) {
    return { tool: 'kind', name: kind[1] }
  }
  const k3d = /^k3d-(.+)$/.exec(context)
  return k3d ? { tool: 'k3d', name: k3d[1] } : null
}

function q(value: string): string {
  return `"${value}"`
}

/** One chain that stops at the first failure; nothing in the repo is edited. */
export function localDeploySteps(plan: Extract<LocalDeployPlan, { ok: true }>): string[] {
  const { image, runtime, cluster, source, namespace, targets, paths: absolute } = plan
  const build = `${runtime} build -t ${image} -f ${q(absolute.dockerfile)} ${q(absolute.dockerContext)}`
  const load =
    cluster.tool === 'k3d'
      ? [`k3d image import ${image} -c ${cluster.name}`]
      : runtime === 'docker'
        ? [`kind load docker-image ${image} --name ${cluster.name}`]
        : [
            `podman save ${image} -o ${q(absolute.archive)}`,
            `kind load image-archive ${q(absolute.archive)} --name ${cluster.name}`
          ]
  const apply =
    source.kind === 'helm'
      ? `helm upgrade --install ${namespace} ${q(absolute.source)} -n ${namespace} --create-namespace`
      : source.kind === 'kustomize'
        ? `kubectl apply -n ${namespace} -k ${q(absolute.source)}`
        : `kubectl apply -n ${namespace} -R -f ${q(absolute.source)}`
  const retarget = targets.flatMap((target) => {
    const ns = target.namespace ?? namespace
    const ref = `${target.kind.toLowerCase()}/${target.name}`
    return [
      `kubectl -n ${ns} set image ${ref} ${target.container}=${image}`,
      `kubectl -n ${ns} rollout status ${ref} --timeout=300s`
    ]
  })
  return [
    build,
    ...load,
    ...(source.kind === 'helm'
      ? []
      : [`kubectl create namespace ${namespace} --dry-run=client -o yaml | kubectl apply -f -`]),
    apply,
    ...retarget
  ]
}
