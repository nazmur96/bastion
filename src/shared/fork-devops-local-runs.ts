/** Fork: what the Launchpad left running on this machine, so it can be stopped from one place. */
export type LocalRunKind = 'kind' | 'k3d' | 'multipass'

export type LocalRun = {
  kind: LocalRunKind
  name: string
  /** As the tool reports it: running, stopped, 1/1… */
  state: string
  /** The command that removes it, ready for a workbench terminal. */
  remove: string
  /** Clusters only: whether the Kubernetes API answered just now. */
  api?: 'ready' | 'down'
}

/** The API server URL in a kubeconfig, when it is on this machine (the only kind we probe). */
export function localApiServer(kubeconfig: string): string | null {
  const match =
    /^\s*server:\s*(https?:\/\/(?:127\.0\.0\.1|localhost|0\.0\.0\.0|\[::1\]):\d+)\s*$/m.exec(
      kubeconfig
    )
  return match?.[1] ?? null
}

/** Names come from tool output and go back into a command line, so only plain names pass. */
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/

export function parseKindClusters(stdout: string): LocalRun[] {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((name) => SAFE_NAME.test(name))
    .map((name) => ({
      kind: 'kind',
      name,
      state: 'running',
      remove: `kind delete cluster --name ${name}`
    }))
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is Record<string, unknown> => item !== null && typeof item === 'object'
      )
    : []
}

function parseJson(stdout: string): unknown {
  try {
    return JSON.parse(stdout)
  } catch {
    return null
  }
}

export function parseK3dClusters(stdout: string): LocalRun[] {
  return records(parseJson(stdout)).flatMap((cluster) => {
    const name = cluster.name
    if (typeof name !== 'string' || !SAFE_NAME.test(name)) {
      return []
    }
    const running = typeof cluster.serversRunning === 'number' ? cluster.serversRunning : 0
    const total = typeof cluster.serversCount === 'number' ? cluster.serversCount : 0
    return [
      {
        kind: 'k3d' as const,
        name,
        state: running > 0 ? 'running' : total > 0 ? 'stopped' : 'unknown',
        remove: `k3d cluster delete ${name}`
      }
    ]
  })
}

export function parseMultipassList(stdout: string): LocalRun[] {
  const parsed = parseJson(stdout)
  const list =
    parsed !== null && typeof parsed === 'object' ? records(Reflect.get(parsed, 'list')) : []
  return list.flatMap((vm) => {
    const name = vm.name
    if (typeof name !== 'string' || !SAFE_NAME.test(name)) {
      return []
    }
    return [
      {
        kind: 'multipass' as const,
        name,
        state: typeof vm.state === 'string' ? vm.state.toLowerCase() : 'unknown',
        remove: `multipass delete --purge ${name}`
      }
    ]
  })
}
