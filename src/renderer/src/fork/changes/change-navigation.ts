import {
  isChangeSourcePath,
  type ChangeEntrance
} from '../../../../shared/fork-changes/change-contract'
import { openWorkspacePage } from '../workspace-desktop/workspace-desktop-state'

let entrance: ChangeEntrance = 'source'
let initialPaths: string[] = []
export function openChanges(through: ChangeEntrance, paths: string[] = []): void {
  entrance = through
  initialPaths = [...new Set(paths.filter(isChangeSourcePath))].sort().slice(0, 20)
  openWorkspacePage('changes')
}
export function changeInitialPaths(): string[] {
  return initialPaths
}
export function changeEntrance(): ChangeEntrance {
  return entrance
}
