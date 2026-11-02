import type { LocalRunKind } from '../../../../shared/fork-devops-local-runs'

/** Fork C1: what the Launchpad started, so End session removes only that and never someone's own cluster. */
export type Launched = { kind: LocalRunKind; name: string }

const KEY = 'orca-fork.launched.v1'

export function readLaunched(): Launched[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    return Array.isArray(parsed)
      ? parsed.filter(
          (item): item is Launched =>
            item !== null &&
            typeof item === 'object' &&
            typeof Reflect.get(item, 'kind') === 'string' &&
            typeof Reflect.get(item, 'name') === 'string'
        )
      : []
  } catch {
    return []
  }
}

function write(items: Launched[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(items))
  } catch {
    // Storage off: End session then simply finds nothing to remove.
  }
}

export function rememberLaunched(item: Launched): void {
  const items = readLaunched().filter((old) => old.kind !== item.kind || old.name !== item.name)
  write([...items, item])
}

export function forgetLaunched(item: Launched): void {
  write(readLaunched().filter((old) => old.kind !== item.kind || old.name !== item.name))
}
