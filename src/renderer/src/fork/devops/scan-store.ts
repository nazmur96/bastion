import { useSyncExternalStore } from 'react'
import type { ScanFinding } from '../../../../shared/fork-devops-scan'

/** Fork: the latest Trivy findings per repo path, shared by the Harden card and editor markers. */
const findingsByRepo = new Map<string, ScanFinding[]>()
const listeners = new Set<() => void>()
let version = 0

export function setScanFindings(repo: string, findings: ScanFinding[]): void {
  findingsByRepo.set(repo, findings)
  version += 1
  listeners.forEach((listener) => listener())
}

export function readScanFindings(repo: string): ScanFinding[] | undefined {
  return findingsByRepo.get(repo)
}

export function subscribeScanFindings(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useScanFindings(repo: string | undefined): ScanFinding[] | undefined {
  useSyncExternalStore(subscribeScanFindings, () => version)
  return repo ? findingsByRepo.get(repo) : undefined
}
