/** Fork: the two path stages only the person can mark (asked Claude, ran a scan), per repo. */
export type PathMarks = { understood: boolean; hardened: boolean }

const KEY = 'orca-fork.pathMarks.v1'

export function readPathMarks(path: string): PathMarks {
  try {
    const all: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}')
    const entry: unknown = all !== null && typeof all === 'object' ? Reflect.get(all, path) : null
    return {
      understood:
        entry !== null && typeof entry === 'object' && Reflect.get(entry, 'understood') === true,
      hardened:
        entry !== null && typeof entry === 'object' && Reflect.get(entry, 'hardened') === true
    }
  } catch {
    return { understood: false, hardened: false }
  }
}

export function markPath(path: string, mark: keyof PathMarks): PathMarks {
  const next = { ...readPathMarks(path), [mark]: true }
  try {
    const all: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}')
    const record =
      all !== null && typeof all === 'object' ? Object.fromEntries(Object.entries(all)) : {}
    localStorage.setItem(KEY, JSON.stringify({ ...record, [path]: next }))
  } catch {
    // Storage off: the mark lasts until the page reloads.
  }
  return next
}
