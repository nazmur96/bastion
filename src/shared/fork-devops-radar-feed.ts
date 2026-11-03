/** Fork: Radar's own findings (its read-only MCP), shown with the map. */
export type RadarFindings = { ok: true; tool: string; text: string } | { ok: false; error: string }

/** A JSON-RPC result from a plain JSON body or an SSE stream (`data: {...}` lines). */
export function parseMcpResponse(body: string): unknown {
  const trimmed = body.trim()
  const candidates = trimmed.startsWith('{')
    ? [trimmed]
    : trimmed
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trim())
  for (const candidate of candidates.toReversed()) {
    try {
      const value: unknown = JSON.parse(candidate)
      if (value && typeof value === 'object' && ('result' in value || 'error' in value)) {
        return value
      }
    } catch {
      // Not JSON: keep looking.
    }
  }
  return null
}

/** The tool that lists problems: Radar names it after issues/problems/health. */
export function pickFindingsTool(names: readonly string[]): string | null {
  return (
    names.find((name) => /issue/i.test(name)) ??
    names.find((name) => /problem|health|diagnos/i.test(name)) ??
    null
  )
}

/** MCP tool result → its text parts joined. */
export function toolText(response: unknown): string | null {
  const content: unknown =
    response && typeof response === 'object'
      ? Reflect.get(Reflect.get(response, 'result') ?? {}, 'content')
      : null
  if (!Array.isArray(content)) {
    return null
  }
  return content
    .map((part) =>
      part && typeof part === 'object' && Reflect.get(part, 'type') === 'text'
        ? String(Reflect.get(part, 'text'))
        : ''
    )
    .filter(Boolean)
    .join('\n')
}
