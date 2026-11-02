/** Fork: the system map — what runs in the cluster and how it connects, from one `kubectl get -o json`. */
export type MapNodeKind =
  | 'Ingress'
  | 'Service'
  | 'Deployment'
  | 'StatefulSet'
  | 'DaemonSet'
  | 'ConfigMap'
  | 'Secret'

export type MapHealth = 'ok' | 'warn' | 'bad'

export type MapNode = {
  id: string
  kind: MapNodeKind
  name: string
  namespace: string
  health: MapHealth
  /** One line for the node: replicas, ports, hosts. */
  detail: string
  /** 0 traffic in, 1 services, 2 workloads, 3 config. */
  layer: 0 | 1 | 2 | 3
}

export type MapEdge = { from: string; to: string }

export type SystemMap = { nodes: MapNode[]; edges: MapEdge[] }

export type SystemMapResult = { ok: true; map: SystemMap } | { ok: false; error: string }

export const SYSTEM_MAP_KINDS = 'deployments,statefulsets,daemonsets,services,ingresses,configmaps'

const SYSTEM_NAMESPACE = /^(kube-|local-path-storage$)/

type Obj = Record<string, unknown>

function isObj(value: unknown): value is Obj {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function obj(value: unknown): Obj {
  return isObj(value) ? value : {}
}

function isWorkload(kind: string): kind is 'Deployment' | 'StatefulSet' | 'DaemonSet' {
  return kind === 'Deployment' || kind === 'StatefulSet' || kind === 'DaemonSet'
}

function list(value: unknown): Obj[] {
  return Array.isArray(value) ? value.map(obj) : []
}

function str(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function num(value: unknown): number {
  return typeof value === 'number' ? value : 0
}

export function mapNodeId(kind: string, namespace: string, name: string): string {
  return `${kind}/${namespace}/${name}`
}

function labelsMatch(selector: Obj, labels: Obj): boolean {
  const keys = Object.keys(selector)
  return keys.length > 0 && keys.every((key) => labels[key] === selector[key])
}

function workloadHealth(
  kind: string,
  status: Obj,
  spec: Obj
): { health: MapHealth; detail: string } {
  const desired =
    kind === 'DaemonSet' ? num(status.desiredNumberScheduled) : num(spec.replicas ?? 1)
  const ready = kind === 'DaemonSet' ? num(status.numberReady) : num(status.readyReplicas)
  const health: MapHealth = desired === 0 || ready >= desired ? 'ok' : ready === 0 ? 'bad' : 'warn'
  return { health, detail: `${ready}/${desired} ready` }
}

/** Config a pod spec reads through env, envFrom and volumes. */
function configRefs(podSpec: Obj): { kind: 'ConfigMap' | 'Secret'; name: string }[] {
  const refs: { kind: 'ConfigMap' | 'Secret'; name: string }[] = []
  const add = (kind: 'ConfigMap' | 'Secret', name: string | null): void => {
    if (name && !refs.some((ref) => ref.kind === kind && ref.name === name)) {
      refs.push({ kind, name })
    }
  }
  for (const container of [...list(podSpec.containers), ...list(podSpec.initContainers)]) {
    for (const from of list(container.envFrom)) {
      add('ConfigMap', str(obj(from.configMapRef).name))
      add('Secret', str(obj(from.secretRef).name))
    }
    for (const env of list(container.env)) {
      const source = obj(env.valueFrom)
      add('ConfigMap', str(obj(source.configMapKeyRef).name))
      add('Secret', str(obj(source.secretKeyRef).name))
    }
  }
  for (const volume of list(podSpec.volumes)) {
    add('ConfigMap', str(obj(volume.configMap).name))
    add('Secret', str(obj(volume.secret).secretName))
  }
  return refs
}

/**
 * `secrets` holds `namespace/name` of Secrets that exist (names only, values are never read);
 * `null` when they could not be listed, so a referenced Secret is shown as unknown, not healthy.
 */
export function buildSystemMap(json: string, secrets: Set<string> | null = null): SystemMap {
  let items: Obj[]
  try {
    items = list(obj(JSON.parse(json)).items)
  } catch {
    return { nodes: [], edges: [] }
  }
  const nodes = new Map<string, MapNode>()
  const edges: MapEdge[] = []
  const configMaps = new Set<string>()
  const workloads: { id: string; namespace: string; labels: Obj; podSpec: Obj }[] = []
  const services: { id: string; namespace: string; selector: Obj }[] = []
  const ingresses: { id: string; namespace: string; backends: string[] }[] = []

  for (const item of items) {
    const kind = str(item.kind)
    const meta = obj(item.metadata)
    const name = str(meta.name)
    const namespace = str(meta.namespace) ?? 'default'
    if (
      !kind ||
      !name ||
      SYSTEM_NAMESPACE.test(namespace) ||
      (kind === 'Service' && namespace === 'default' && name === 'kubernetes')
    ) {
      continue
    }
    const id = mapNodeId(kind, namespace, name)
    const spec = obj(item.spec)
    if (isWorkload(kind)) {
      const { health, detail } = workloadHealth(kind, obj(item.status), spec)
      nodes.set(id, { id, kind, name, namespace, health, detail, layer: 2 })
      const template = obj(spec.template)
      workloads.push({
        id,
        namespace,
        labels: obj(obj(template.metadata).labels),
        podSpec: obj(template.spec)
      })
    } else if (kind === 'Service') {
      const ports = list(spec.ports)
        .map((port) => num(port.port))
        .filter(Boolean)
      nodes.set(id, {
        id,
        kind,
        name,
        namespace,
        health: 'ok',
        detail: `${str(spec.type) ?? 'ClusterIP'} :${ports.join(',')}`,
        layer: 1
      })
      services.push({ id, namespace, selector: obj(spec.selector) })
    } else if (kind === 'Ingress') {
      const rules = list(spec.rules)
      const backends = rules.flatMap((rule) =>
        list(obj(rule.http).paths).flatMap((path) => {
          const service = str(obj(obj(path.backend).service).name)
          return service ? [service] : []
        })
      )
      const defaultService = str(obj(obj(spec.defaultBackend).service).name)
      nodes.set(id, {
        id,
        kind,
        name,
        namespace,
        health: 'ok',
        detail: rules.map((rule) => str(rule.host) ?? '*').join(', ') || '*',
        layer: 0
      })
      ingresses.push({
        id,
        namespace,
        backends: defaultService ? [...backends, defaultService] : backends
      })
    } else if (kind === 'ConfigMap') {
      configMaps.add(id)
    }
  }

  for (const service of services) {
    const targets = workloads.filter(
      (workload) =>
        workload.namespace === service.namespace && labelsMatch(service.selector, workload.labels)
    )
    targets.forEach((workload) => edges.push({ from: service.id, to: workload.id }))
    const node = nodes.get(service.id)
    if (node && targets.length === 0 && Object.keys(service.selector).length > 0) {
      nodes.set(service.id, { ...node, health: 'warn', detail: `${node.detail} · no workload` })
    }
  }
  for (const ingress of ingresses) {
    for (const backend of new Set(ingress.backends)) {
      const target = mapNodeId('Service', ingress.namespace, backend)
      if (nodes.has(target)) {
        edges.push({ from: ingress.id, to: target })
      } else {
        const node = nodes.get(ingress.id)
        if (node) {
          nodes.set(ingress.id, { ...node, health: 'warn' })
        }
      }
    }
  }
  for (const workload of workloads) {
    for (const ref of configRefs(workload.podSpec)) {
      const id = mapNodeId(ref.kind, workload.namespace, ref.name)
      const exists =
        ref.kind === 'Secret'
          ? secrets === null
            ? null
            : secrets.has(`${workload.namespace}/${ref.name}`)
          : configMaps.has(id)
      if (!nodes.has(id)) {
        nodes.set(id, {
          id,
          kind: ref.kind,
          name: ref.name,
          namespace: workload.namespace,
          health: exists === false ? 'bad' : exists === null ? 'warn' : 'ok',
          detail:
            exists === false ? 'missing' : exists === null ? 'not checked' : ref.kind.toLowerCase(),
          layer: 3
        })
      }
      edges.push({ from: workload.id, to: id })
    }
  }
  return { nodes: [...nodes.values()], edges }
}

/** Everything a node feeds: what breaks if it does. */
export function downstreamOf(map: SystemMap, id: string): Set<string> {
  const seen = new Set<string>()
  const walk = (from: string): void => {
    for (const edge of map.edges) {
      if (edge.from === from && !seen.has(edge.to)) {
        seen.add(edge.to)
        walk(edge.to)
      }
    }
  }
  walk(id)
  return seen
}

/** Everything that depends on a node: who is hit if it breaks. */
export function upstreamOf(map: SystemMap, id: string): Set<string> {
  const seen = new Set<string>()
  const walk = (to: string): void => {
    for (const edge of map.edges) {
      if (edge.to === to && !seen.has(edge.from)) {
        seen.add(edge.from)
        walk(edge.from)
      }
    }
  }
  walk(id)
  return seen
}
