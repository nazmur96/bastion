import { devopsTone, type DevopsContextTone } from './fork-devops-context'

/** Fork: the app across every cluster context, side by side. */
export type EnvWorkload = { name: string; ready: number; desired: number; image: string }

export type EnvColumn = {
  context: string
  tone: DevopsContextTone
  /** null: the cluster did not answer (reason in `error`). */
  workloads: EnvWorkload[] | null
  error?: string
}

export type EnvironmentsResult =
  | { ok: true; current: string | null; columns: EnvColumn[] }
  | { ok: false; error: string }

const LOCAL_CONTEXT = /^(kind-|vcluster-docker_|k3d-|minikube$|docker-desktop$|rancher-desktop$)/

export function contextTone(context: string): DevopsContextTone {
  return devopsTone(context, LOCAL_CONTEXT.test(context))
}

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

/** `kubectl get deploy,statefulset -o json` → name, ready/desired and the first container's image tag. */
export function envWorkloads(json: string): EnvWorkload[] {
  let items: unknown
  try {
    items = at(JSON.parse(json), 'items')
  } catch {
    return []
  }
  return (Array.isArray(items) ? items : []).flatMap((item): EnvWorkload[] => {
    const name = at(item, 'metadata', 'name')
    const containers = at(item, 'spec', 'template', 'spec', 'containers')
    const image = Array.isArray(containers) ? at(containers[0], 'image') : undefined
    if (typeof name !== 'string') {
      return []
    }
    const desired = at(item, 'spec', 'replicas')
    const ready = at(item, 'status', 'readyReplicas')
    return [
      {
        name,
        desired: typeof desired === 'number' ? desired : 1,
        ready: typeof ready === 'number' ? ready : 0,
        image: typeof image === 'string' ? (image.split('/').at(-1) ?? image) : '?'
      }
    ]
  })
}
