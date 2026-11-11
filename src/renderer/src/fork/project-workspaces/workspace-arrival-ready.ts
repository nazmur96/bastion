let acknowledged = false

/** Tell a waiting source window this destination has loaded its own content and may be shown. */
export function acknowledgeWorkspaceArrival(): void {
  if (acknowledged) {
    return
  }
  acknowledged = true
  let sent = false
  const send = (): void => {
    if (!sent) {
      sent = true
      void window.api.projectWorkspaces?.ready?.()
    }
  }
  // A destination stays hidden until released, and hidden windows may never receive frames.
  setTimeout(send, 250)
  requestAnimationFrame(() => requestAnimationFrame(send))
}
