import type { AiVaultAgent, AiVaultScanIssue } from '../../shared/ai-vault-types'

export type SessionFileDiscoveryArgs = {
  rootDir: string
  limit: number
  agent: AiVaultAgent
  issues: AiVaultScanIssue[]
  extensions: string[]
  filePredicate?: (path: string) => boolean
  contentDependencyPath?: (path: string) => string | undefined | Promise<string | undefined>
  directoryPredicate?: (name: string, depth: number) => boolean
  // A scoped scan walks every file this agent has, not only the newest `limit`.
  keepScopeFiles?: boolean
  signal?: AbortSignal
}
