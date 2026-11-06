import { useCallback, useEffect, useRef } from 'react'
import { useAppStore } from '@/store'
import { workbenchGroupId } from '../workbench/workbench-terminals'
import { setInfraOverlayTarget, setInfraView, useInfraView } from './infra-home-store'
import { HidePaneSurfaces } from '../workbench/HidePaneSurfaces'

/** The workbench body's cover for the Project path's full map and Tools view; the path column
 *  draws into it, so they read as tabs beside chat and files. */
export function InfraHomeOverlay({
  worktreeId,
  groupId
}: {
  worktreeId: string
  groupId: string
}): React.JSX.Element | null {
  const view = useInfraView(worktreeId)
  const isWorkbench = useAppStore(() => workbenchGroupId(worktreeId) === groupId)
  const activeTabId = useAppStore(
    (state) =>
      state.groupsByWorktree[worktreeId]?.find((group) => group.id === groupId)?.activeTabId
  )
  const seenTab = useRef(activeTabId)
  useEffect(() => {
    // Picking a tab in this group means the person wants that tab, not the map or Tools.
    if (seenTab.current !== activeTabId) {
      seenTab.current = activeTabId
      if (isWorkbench) {
        setInfraView(worktreeId, null)
      }
    }
  }, [activeTabId, isWorkbench, worktreeId])
  const register = useCallback(
    (element: HTMLDivElement | null) => setInfraOverlayTarget(worktreeId, element),
    [worktreeId]
  )
  if (!isWorkbench) {
    return null
  }
  return (
    <>
      {view ? <HidePaneSurfaces groupId={groupId} /> : null}
      <div
        ref={register}
        hidden={!view}
        className="absolute inset-0 z-30 overflow-y-auto bg-background scrollbar-sleek"
        data-infra-overlay=""
      />
    </>
  )
}
