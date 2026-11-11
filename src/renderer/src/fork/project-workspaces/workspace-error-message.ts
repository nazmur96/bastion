/** Electron prefixes main-process errors with IPC plumbing; show only the message meant for people. */
export function workspaceErrorMessage(cause: unknown): string {
  const text = cause instanceof Error ? cause.message : String(cause)
  return text.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '')
}
