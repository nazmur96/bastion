/** 1-based line of the `kind:` in the YAML document that defines `kind`/`name`, or null. */
export function manifestLine(text: string, kind: string, name: string): number | null {
  const lines = text.split(/\r?\n/)
  let docStart = 0
  const check = (end: number): number | null => {
    let kindLine = -1
    let named = false
    for (let index = docStart; index < end; index += 1) {
      const line = lines[index]
      if (new RegExp(`^kind:\\s*${kind}\\s*$`).test(line)) {
        kindLine = index
      }
      const match = /^\s{2}name:\s*["']?([^"'\s#]+)["']?\s*(#.*)?$/.exec(line)
      if (match?.[1] === name) {
        named = true
      }
    }
    return kindLine >= 0 && named ? kindLine + 1 : null
  }
  for (let index = 0; index <= lines.length; index += 1) {
    if (index === lines.length || /^---\s*$/.test(lines[index])) {
      const found = check(index)
      if (found !== null) {
        return found
      }
      docStart = index + 1
    }
  }
  return null
}
