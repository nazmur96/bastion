import { useSyncExternalStore } from 'react'
import type { DevopsInspection } from '../../../../shared/fork-devops-inspection'

import {
  discoverySourceWanted,
  isDiscoverySensitivePath
} from '../discovery/discovery-source-facts'
import type { DiscoverySnapshot } from '../discovery/service-knowledge'

export type RuntimeAssistance = { tool: string; available: boolean | null }
export function assistanceFileAllowed(file: string): boolean {
  return (
    file.length <= 256 &&
    !isDiscoverySensitivePath(file) &&
    !file.split(/[\\/]/).some((part) => !part || part === '..' || part === '.') &&
    !file.includes(':') &&
    ![...file].some((char) => char.charCodeAt(0) < 32)
  )
}
export function runtimeAssistanceForFile(
  file: string,
  inspection: DevopsInspection | null,
  allowUnknown = false
): RuntimeAssistance | null {
  if (isDiscoverySensitivePath(file)) {
    return null
  }
  const path = file.toLowerCase().replaceAll('\\', '/')
  const tool = /\.tf(?:\.json)?$/.test(path)
    ? 'terraform'
    : /(^|\/)chart\.yaml$/.test(path)
      ? 'helm'
      : /(^|\/)(dockerfile(?:\.[^/]+)?|containerfile|(?:docker-)?compose[^/]*\.ya?ml)$/.test(path)
        ? 'docker'
        : null
  const status = tool ? inspection?.tools[tool] : undefined
  return tool && (status || allowUnknown) ? { tool, available: status?.available ?? null } : null
}

export type AssistanceContext = {
  hostId: string
  modelVersion: number
  editorOwner: string
  sourceFingerprint: string
  connectionSignature?: string
  inputSignature?: string
  diagnosticSignature?: string
  targetSignature: string
  valid: boolean
}
export function assistanceSourceCurrent(
  snapshot: DiscoverySnapshot,
  file: string,
  state: { pending: boolean; error?: string; changedPaths: string[] | null; watchFailed: boolean }
): boolean {
  // A partial snapshot is still current: unrelated uninspected files must not block this file.
  if (state.pending || state.error || state.watchFailed || state.changedPaths === null) {
    return false
  }
  return !state.changedPaths.some(
    (path) =>
      discoverySourceWanted(path) ||
      /(^|\/)\.terraform\/environment$/.test(path) ||
      /(^|\/)(\.?mise\.toml|devenv\.nix|orca\.yaml|\.tool-versions|\.devcontainer(?:\.json|\/))/.test(
        path
      ) ||
      path === file ||
      file.startsWith(`${path}/`) ||
      snapshot.facts.some((fact) => fact.evidence.some((e) => e.path === path))
  )
}
export function boundedAssistanceDraft(
  file: string,
  suggestion: RuntimeAssistance,
  snapshot: DiscoverySnapshot,
  diagnosticCounts: { errors: number; warnings: number }
): string {
  if (!assistanceFileAllowed(file)) {
    throw new Error('This file is excluded from assistance context.')
  }
  const references = [
    ...new Set(
      snapshot.facts
        .flatMap((fact) => fact.evidence.map((e) => e.path))
        .filter((path) => path === file && assistanceFileAllowed(path))
    )
  ].slice(0, 3)
  return [
    'Review the selected file and propose a minimal next step. This is a request draft, not execution approval.',
    `File: ${JSON.stringify(file)}`,
    `Runtime capability: ${suggestion.tool} CLI ${
      suggestion.available === null
        ? 'unverified on this owner'
        : suggestion.available
          ? 'found by the last owner-scoped inspection'
          : 'not found by the last owner-scoped inspection'
    }`,
    `Editor diagnostics: ${Math.min(diagnosticCounts.errors, 100)} errors, ${Math.min(
      diagnosticCounts.warnings,
      100
    )} warnings. Diagnostic messages and source text are intentionally omitted.`,
    `Evidence paths: ${
      references.length
        ? references.map((path) => JSON.stringify(path)).join(', ')
        : 'no inspected declaration for this file'
    }`,
    ...(snapshot.limits.length > 1
      ? ['Discovery snapshot is partial: some project files were not inspected.']
      : []),
    'Deployment target is unverified. Confirm the execution environment and relevant source with the engineer before proposing a change.',
    'Use the declared development environment. Do not install host tools, run commands, retrieve secrets, contact cloud services or change infrastructure. Explain your proposal for human review.'
  ]
    .join('\n')
    .slice(0, 2400)
}

const dismissed = new Set<string>()
const listeners = new Set<() => void>()

export function runtimeAssistanceKey(
  worktreeId: string,
  file: string,
  suggestion: RuntimeAssistance,
  context?: AssistanceContext
): string {
  return JSON.stringify([
    worktreeId,
    file,
    suggestion.tool,
    suggestion.available,
    ...(context ? [context] : [])
  ])
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
