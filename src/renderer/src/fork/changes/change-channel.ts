import type { ChangeRecord, ChangeCommand } from '../../../../shared/fork-changes/change-contract'
const listeners = new Set<(record: ChangeRecord) => void>()
export function subscribeChangeProgress(listener: (record: ChangeRecord) => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function changesApi() {
  if (!window.api.changes) {
    throw new Error('Change records require the desktop application.')
  }
  return window.api.changes
}

export async function updateChange(
  record: ChangeRecord,
  command: ChangeCommand
): Promise<ChangeRecord> {
  const next = await changesApi().command({ id: record.id, revision: record.revision, command })
  for (const listener of listeners) {
    listener(next)
  }
  return next
}
