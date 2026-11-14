import {
  isChangeSourcePath,
  type ChangeEntrance,
  SOURCE_CHECK_INTENT,
  type ChangeIntent
} from '../../../../shared/fork-changes/change-contract'
import { proposalDraft, retainProposalDraft } from './proposal-drafts'
import { useAppStore } from '@/store'
import { openWorkspacePage } from '../workspace-desktop/workspace-desktop-state'

let entrance: ChangeEntrance = 'source'
let initialPaths: string[] = []
let initialIntent: ChangeIntent = SOURCE_CHECK_INTENT
let seedProjectId: string | null = null
export function openChanges(through: ChangeEntrance, paths: string[] = []): void {
  entrance = through
  seedProjectId = useAppStore.getState().activeWorktreeId
  initialIntent = SOURCE_CHECK_INTENT
  initialPaths = [...new Set(paths.filter(isChangeSourcePath))].sort().slice(0, 20)
  openWorkspacePage('changes')
}
export function openFileProposal(
  through: ChangeEntrance,
  projectId: string,
  name: string,
  content: string
): void {
  if (proposalDraft(projectId, name) === undefined) {
    retainProposalDraft(projectId, name, content)
  }
  seedProjectId = projectId
  entrance = through
  initialIntent = { id: `file:${name}`, kind: 'create-file' }
  openWorkspacePage('changes')
}
export function changeInitialIntent(projectId: string): ChangeIntent {
  return seedProjectId === projectId ? initialIntent : SOURCE_CHECK_INTENT
}
export function changeInitialPaths(projectId: string): string[] {
  return seedProjectId === projectId ? initialPaths : []
}
export function changeEntrance(): ChangeEntrance {
  return entrance
}

export function openCloudSourceChecks(): void {
  openChanges('cloud')
  initialIntent = {
    id: 'source-check:cloud',
    kind: 'source-check',
    targetMode: 'selected-cloud',
    label: 'Targeted source checks'
  }
}
