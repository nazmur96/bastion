import { restoreWorkbenchLayout } from '../workbench/workbench-focus'
import { setInfraView } from '../devops/infra-home-store'
import { setSideSection } from '../workbench/side-panel-store'
import { isSidePanelCollapsed, toggleSidePanel } from '../workbench/terminal-dock'
import { useSyncExternalStore } from 'react'
import { useAppStore } from '@/store'

export type WorkspacePage =
  | 'home'
  | 'discovery'
  | 'editor'
  | 'source'
  | 'agents'
  | 'environments'
  | 'cloud'
  | 'recipes'
  | 'delivery'
  | 'observability'
let page: WorkspacePage = 'home'
const listeners = new Set<() => void>()
export function openWorkspacePage(next: WorkspacePage): void {
  const id = useAppStore.getState().activeWorktreeId
  if (id && next !== 'editor' && next !== 'source') {
    restoreWorkbenchLayout(id)
  }
  if (id && (next === 'editor' || next === 'source')) {
    setInfraView(id, null)
  }
  if (id && next === 'source') {
    setSideSection(id, 'changes')
    if (isSidePanelCollapsed(id)) {
      toggleSidePanel(id)
    }
  }
  page = next
  useAppStore.getState().setActiveView('terminal')
  for (const listener of listeners) {
    listener()
  }
}
export function useWorkspacePage(): WorkspacePage {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => page
  )
}
