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
import type { LaunchpadFiles } from '../../shared/fork-devops-launchpad'
import type { StepsEvent, StepsRequest } from '../../shared/fork-devops-steps'
import type { ObservabilityPlan } from '../../shared/fork-devops-observability'
import type { MetricsResult } from '../../shared/fork-devops-metrics'
import type { ScanResult } from '../../shared/fork-devops-scan'
import type { CloudReadiness } from '../../shared/fork-devops-cloud'
import type { LocalDeployPlan } from '../../shared/fork-devops-local-deploy'
import type { ProjectRepo } from '../../shared/fork-devops-project'
import type { ArgoDeployPlan } from '../../shared/fork-devops-argo-deploy'
import type { TerraformPlanResult } from '../../shared/fork-terraform-plan'
import type { SystemMapResult } from '../../shared/fork-devops-system-map'
import type { LocalRun } from '../../shared/fork-devops-local-runs'
import type { DevopsInspection, DevopsToolStatus } from '../../shared/fork-devops-inspection'
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
  /** Fork: which Launchpad CLIs this workspace can run, keyed by tool. */
  /** Fork: local clusters and VMs on this machine (kind, k3d, Multipass). */
  /** Fork: the cluster as a graph, read-only, for the system map. */
  readSystemMap: (workspacePath: string) => Promise<SystemMapResult>
  /** Fork: run steps one by one, streamed as StepsEvent; cancel kills the current step. */
  runSteps: (request: StepsRequest) => Promise<boolean>
  cancelSteps: (runId: string) => Promise<void>
  onStepsEvent: (callback: (event: StepsEvent) => void) => () => void
  /** Fork F3: write the DevPod per-workspace environment recipe into the repo. */
  addDevpodRecipe: (
    workspacePath: string
  ) => Promise<{ ok: true; files: string[] } | { ok: false; error: string }>
  /** Fork observability: reuse or install Prometheus + Grafana, monitor and dashboard for the app. */
  observabilityPlan: (request: {
    workspacePath: string
    namespace: string
  }) => Promise<ObservabilityPlan>
  probeGrafana: (port: number) => Promise<boolean>
  /** Fork observability: CPU, memory and restarts per workload (metrics-server), read-only. */
  workloadMetrics: (workspacePath: string) => Promise<MetricsResult>
  /** Fork path stage Harden: Trivy misconfigurations with their files and lines (read-only). */
  scanRepo: (workspacePath: string) => Promise<ScanResult>
  /** Fork path stage 5: AWS identity, region and budgets for this workspace (read-only). */
  cloudReadiness: (workspacePath: string) => Promise<CloudReadiness | { error: string }>
  /** Fork path stage 2: build this app and run it on the local cluster (read-only plan). */
  localDeployPlan: (request: {
    appPath: string
    manifestsPath: string
    clusterPath: string
  }) => Promise<LocalDeployPlan>
  /** Fork path step 2: the open repo and related sibling repos, for one-project grouping. */
  projectRepos: (
    workspacePath: string
  ) => Promise<{ current: ProjectRepo; siblings: ProjectRepo[] } | null>
  /** Fork path stage 3: deploy this repo with Argo CD. */
  argoDeployPlan: (request: { repoPath: string; clusterPath: string }) => Promise<ArgoDeployPlan>
  writeArgoApplication: (request: { name: string; yaml: string }) => Promise<string | null>
  probeArgoUi: (port: number) => Promise<boolean>
  /** Fork A3: plan only (init if needed, plan -out, show -json); never applies. */
  terraformPlan: (request: {
    workspacePath: string
    dir: string
    refreshOnly?: boolean
    destroy?: boolean
  }) => Promise<TerraformPlanResult>
  terraformOutputs: (request: {
    workspacePath: string
    dir: string
  }) => Promise<Record<string, string> | { error: string }>
  findManifest: (request: {
    workspacePath: string
    kind: string
    name: string
  }) => Promise<{ path: string; line: number; kustomize: string | null } | null>
  listLocalRuns: (workspacePath: string) => Promise<LocalRun[]>
  /** Fork: path of the Launchpad's 3-node kind config, written on demand. */
  launchpadFiles: () => Promise<LaunchpadFiles>
  checkLaunchpadTools: (workspacePath: string) => Promise<Record<string, DevopsToolStatus>>
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
