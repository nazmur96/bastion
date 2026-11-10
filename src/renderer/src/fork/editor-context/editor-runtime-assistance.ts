import { useSyncExternalStore } from 'react'
import type { DevopsInspection } from '../../../../shared/fork-devops-inspection'

export type RuntimeAssistance = { tool: 'terraform'; available: boolean }

export function runtimeAssistanceForFile(
  file: string,
  inspection: DevopsInspection | null
): RuntimeAssistance | null {
  const path = file.toLowerCase()
  const terraform = ['.tf', '.tf.json', '.tfvars', '.tfvars.json'].some((ext) => path.endsWith(ext))
  const tool = inspection?.tools.terraform
  return terraform && tool ? { tool: 'terraform', available: tool.available } : null
}

const dismissed = new Set<string>()
const listeners = new Set<() => void>()

export function runtimeAssistanceKey(
  worktreeId: string,
  file: string,
  suggestion: RuntimeAssistance
): string {
  return JSON.stringify([worktreeId, file, suggestion.tool, suggestion.available])
}

export function isRuntimeAssistanceDismissed(key: string): boolean {
  return dismissed.has(key)
}

export function setRuntimeAssistanceDismissed(key: string, value: boolean): void {
  if (dismissed.has(key) === value) {
    return
  }
  if (value) {
    dismissed.add(key)
  } else {
    dismissed.delete(key)
  }
  for (const listener of listeners) {
    listener()
  }
}

export function useRuntimeAssistanceDismissed(key: string): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => isRuntimeAssistanceDismissed(key),
    () => false
  )
}
