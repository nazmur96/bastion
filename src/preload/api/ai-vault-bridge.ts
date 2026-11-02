import type {
  ClaudeInlineEditRequest,
  ResolveClaudeEditsRequest
} from '../../shared/fork-claude-edits'
import { createSessionSearchClient } from '../../shared/ai-vault-search-client'
import type { AiVaultSearchRequest, AiVaultSearchStatus } from '../../shared/ai-vault-search-types'
import type { DevopsSandboxRequest } from '../../shared/fork-devops-sandbox'
import type { ExecutionHostId, ExecutionHostScope } from '../../shared/execution-host'
import { ipcRenderer } from 'electron'
import type {
  AiVaultDeleteSessionArgs,
  AiVaultDeleteSessionResult
} from '../../shared/ai-vault-session-deletion'
import type {
  AiVaultFirstUserPromptArgs,
  AiVaultListArgs,
  AiVaultSubagentListArgs
} from '../../shared/ai-vault-types'
import type { AiVaultSessionTitlesArgs } from '../../shared/ai-vault-session-title'
import type { AiVaultPrepareSessionResumeRequest } from '../../shared/ai-vault-resume-preparation'
import type { PreloadApi } from '../api-types'
import {
  AI_VAULT_SCAN_PROGRESS_CHANNEL,
  type AiVaultScanProgress,
  type AiVaultScanProgressUpdate
} from '../../shared/ai-vault-scan-progress'

function searchClient(
  executionHostScope?: ExecutionHostScope
): ReturnType<typeof createSessionSearchClient> {
  // Main negotiates and redacts every remote leg before answering this same-build IPC boundary.
  return createSessionSearchClient(
    (method, params) =>
      method === 'aiVault.searchSessions'
        ? ipcRenderer.invoke('aiVault:searchSessions', params, executionHostScope)
        : ipcRenderer.invoke('aiVault:searchStatus', executionHostScope),
    'ipc'
  )
}

export const aiVaultApi = {
  searchSessions: (request: AiVaultSearchRequest, executionHostScope?: ExecutionHostScope) =>
    searchClient(executionHostScope).searchSessions(request),
  searchStatus: (executionHostScope?: ExecutionHostId) =>
    searchClient(executionHostScope).searchStatus(),
  setSearchEnabled: (
    executionHostId: ExecutionHostId,
    enabled: boolean
  ): Promise<AiVaultSearchStatus> =>
    ipcRenderer.invoke('aiVault:setSearchEnabled', executionHostId, enabled),
  clearSearchIndex: (): Promise<void> => ipcRenderer.invoke('aiVault:clearSearchIndex'),
  listSessions: (args?: AiVaultListArgs) => ipcRenderer.invoke('aiVault:listSessions', args),
  resolveSessionTitles: (args: AiVaultSessionTitlesArgs) =>
    ipcRenderer.invoke('aiVault:resolveSessionTitles', args),
  cancelListSessions: (args: { requestToken: string }): Promise<void> =>
    ipcRenderer.invoke('aiVault:cancelListSessions', args),
  prepareSessionResume: (args: AiVaultPrepareSessionResumeRequest) =>
    ipcRenderer.invoke('aiVault:prepareSessionResume', args),
  copyChatForSideChat: (source: { sessionId: string; workspaceId: string }) =>
    ipcRenderer.invoke('aiVault:copyChatForSideChat', source),
  listClaudeEdits: (workspacePath: string) =>
    ipcRenderer.invoke('aiVault:listClaudeEdits', workspacePath),
  resolveClaudeEdits: (request: ResolveClaudeEditsRequest) =>
    ipcRenderer.invoke('aiVault:resolveClaudeEdits', request),
  claudeInlineEdit: (request: ClaudeInlineEditRequest) =>
    ipcRenderer.invoke('aiVault:claudeInlineEdit', request),
  writeReviewedClaudeEdit: (request: { workspacePath: string; path: string; content: string }) =>
    ipcRenderer.invoke('aiVault:writeReviewedClaudeEdit', request),
  inspectDevops: (workspacePath: string) =>
    ipcRenderer.invoke('aiVault:inspectDevops', workspacePath),
  readSystemMap: (workspacePath: string) =>
    ipcRenderer.invoke('aiVault:readSystemMap', workspacePath),
  terraformPlan: (request: { workspacePath: string; dir: string; refreshOnly?: boolean }) =>
    ipcRenderer.invoke('aiVault:terraformPlan', request),
  findManifest: (request: { workspacePath: string; kind: string; name: string }) =>
    ipcRenderer.invoke('aiVault:findManifest', request),
  listLocalRuns: (workspacePath: string) =>
    ipcRenderer.invoke('aiVault:listLocalRuns', workspacePath),
  kindMultiNodeConfig: () => ipcRenderer.invoke('aiVault:kindMultiNodeConfig'),
  checkLaunchpadTools: (workspacePath: string) =>
    ipcRenderer.invoke('aiVault:checkLaunchpadTools', workspacePath),
  readDevopsSandbox: (workspacePath: string) =>
    ipcRenderer.invoke('aiVault:readDevopsSandbox', workspacePath),
  runDevopsSandbox: (request: DevopsSandboxRequest) =>
    ipcRenderer.invoke('aiVault:runDevopsSandbox', request),
  readDevopsContext: (request: { workspacePath: string; terraformDir: string | null }) =>
    ipcRenderer.invoke('aiVault:readDevopsContext', request),
  readDevopsRadar: (workspacePath: string) =>
    ipcRenderer.invoke('aiVault:readDevopsRadar', workspacePath),
  runDevopsRadar: (request: { workspacePath: string; action: 'start' | 'stop' }) =>
    ipcRenderer.invoke('aiVault:runDevopsRadar', request),
  listSubagentSessions: (args: AiVaultSubagentListArgs) =>
    ipcRenderer.invoke('aiVault:listSubagentSessions', args),
  getFirstUserPrompt: (args: AiVaultFirstUserPromptArgs) =>
    ipcRenderer.invoke('aiVault:getFirstUserPrompt', args),
  deleteSession: (args: AiVaultDeleteSessionArgs): Promise<AiVaultDeleteSessionResult> =>
    ipcRenderer.invoke('aiVault:deleteSession', args),
  onWindowFocused: (callback: () => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent) => callback()
    ipcRenderer.on('aiVault:windowFocused', listener)
    return () => ipcRenderer.removeListener('aiVault:windowFocused', listener)
  },
  getScanProgress: (scanKey: string): Promise<AiVaultScanProgress | null> =>
    ipcRenderer.invoke('aiVault:getScanProgress', scanKey),
  onScanProgress: (callback: (update: AiVaultScanProgressUpdate) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, update: AiVaultScanProgressUpdate) =>
      callback(update)
    ipcRenderer.on(AI_VAULT_SCAN_PROGRESS_CHANNEL, listener)
    return () => ipcRenderer.removeListener(AI_VAULT_SCAN_PROGRESS_CHANNEL, listener)
  }
} satisfies PreloadApi['aiVault']
