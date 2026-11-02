import type {
  ClaudeEdit,
  ClaudeInlineEditRequest,
  ClaudeInlineEditResult,
  ResolveClaudeEditsRequest
} from '../../shared/fork-claude-edits'
import type {
  AiVaultSearchRequest,
  AiVaultSearchResponse,
  AiVaultSearchStatus
} from '../../shared/ai-vault-search-types'
import type {
  AiVaultDeleteSessionArgs,
  AiVaultDeleteSessionResult
} from '../../shared/ai-vault-session-deletion'
import type {
  AiVaultFirstUserPromptArgs,
  AiVaultFirstUserPromptResult,
  AiVaultListArgs,
  AiVaultListResult,
  AiVaultSubagentListArgs,
  AiVaultSubagentListResult
} from '../../shared/ai-vault-types'
import type {
  AiVaultSessionTitlesArgs,
  AiVaultSessionTitlesResult
} from '../../shared/ai-vault-session-title'
import type {
  AiVaultPrepareSessionResumeRequest,
  AiVaultPrepareSessionResumeResult
} from '../../shared/ai-vault-resume-preparation'
import type { ExecutionHostId, ExecutionHostScope } from '../../shared/execution-host'
import type { DevopsInspection } from '../../shared/fork-devops-inspection'
import type { DevopsContext } from '../../shared/fork-devops-context'
import type { DevopsRadarResult } from '../../shared/fork-devops-radar'
import type {
  DevopsSandboxRequest,
  DevopsSandboxResult,
  DevopsSandboxState
} from '../../shared/fork-devops-sandbox'
import type {
  AiVaultScanProgress,
  AiVaultScanProgressUpdate
} from '../../shared/ai-vault-scan-progress'

export type AiVaultApi = {
  /** Omitted host means this host; `all` is merged by this desktop across every enumerated host. */
  searchSessions: (
    request: AiVaultSearchRequest,
    executionHostScope?: ExecutionHostScope
  ) => Promise<AiVaultSearchResponse>
  /** Status describes one index, so it never accepts the `all` scope. */
  searchStatus: (executionHostScope?: ExecutionHostId) => Promise<AiVaultSearchStatus>
  /** Paired servers only; SSH rejects as unsupported, older servers as host-too-old. */
  setSearchEnabled: (
    executionHostId: ExecutionHostId,
    enabled: boolean
  ) => Promise<AiVaultSearchStatus>
  /** Rebuilds the local index after deletion. */
  clearSearchIndex: () => Promise<void>
  listSessions: (args?: AiVaultListArgs) => Promise<AiVaultListResult>
  resolveSessionTitles: (args: AiVaultSessionTitlesArgs) => Promise<AiVaultSessionTitlesResult>
  cancelListSessions: (args: { requestToken: string }) => Promise<void>
  prepareSessionResume: (
    args: AiVaultPrepareSessionResumeRequest
  ) => Promise<AiVaultPrepareSessionResumeResult>
  /** Fork: an unowned copy of a local Claude chat for a side chat. */
  copyChatForSideChat: (source: {
    sessionId: string
    workspaceId: string
  }) => Promise<{ sessionId: string }>
  /** Fork: files Claude edited in a workspace, pending review. */
  listClaudeEdits: (workspacePath: string) => Promise<ClaudeEdit[]>
  /** Fork: keep (forget the snapshot) or undo (restore it) pending Claude edits. */
  resolveClaudeEdits: (request: ResolveClaudeEditsRequest) => Promise<void>
  /** Fork: Cmd+K, one quick Claude rewrite of a selection. */
  claudeInlineEdit: (request: ClaudeInlineEditRequest) => Promise<ClaudeInlineEditResult>
  /** Fork: the Toolbelt's view of a workspace: stacks found and tools available. */
  inspectDevops: (workspacePath: string) => Promise<DevopsInspection>
  /** Fork F4: the workspace's local sandbox (Floci, vind) and its lifecycle. */
  readDevopsSandbox: (workspacePath: string) => Promise<DevopsSandboxState>
  runDevopsSandbox: (request: DevopsSandboxRequest) => Promise<DevopsSandboxResult>
  /** Fork A1: kube context, AWS profile and Terraform workspace for the context bar. */
  readDevopsContext: (request: {
    workspacePath: string
    terraformDir: string | null
  }) => Promise<DevopsContext>
  /** Fork B1: the workspace's Radar cluster view, with its MCP server for Claude. */
  readDevopsRadar: (workspacePath: string) => Promise<DevopsRadarResult>
  runDevopsRadar: (request: {
    workspacePath: string
    action: 'start' | 'stop'
  }) => Promise<DevopsRadarResult>
  /** Fork: save a file after undoing some of Claude's blocks in the review dialog. */
  writeReviewedClaudeEdit: (request: {
    workspacePath: string
    path: string
    content: string
  }) => Promise<boolean>
  listSubagentSessions: (args: AiVaultSubagentListArgs) => Promise<AiVaultSubagentListResult>
  getFirstUserPrompt: (args: AiVaultFirstUserPromptArgs) => Promise<AiVaultFirstUserPromptResult>
  /** Moves a deletable session's transcript to the OS trash; local sessions only. */
  deleteSession: (args: AiVaultDeleteSessionArgs) => Promise<AiVaultDeleteSessionResult>
  /** Fires when any app window regains OS focus. */
  onWindowFocused: (callback: () => void) => () => void
  /** The local scan entry for a request key, if it is still retained. */
  getScanProgress: (scanKey: string) => Promise<AiVaultScanProgress | null>
  onScanProgress: (callback: (update: AiVaultScanProgressUpdate) => void) => () => void
}
