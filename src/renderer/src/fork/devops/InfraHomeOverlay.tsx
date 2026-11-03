import { useEffect, useRef } from 'react'
import { useAppStore } from '@/store'
import { workbenchGroupId } from '../workbench/workbench-terminals'
import { useDevopsInspection } from './use-devops-inspection'
import { openInfraHomeOnce, setInfraHomeOpen, useInfraHomeOpen } from './infra-home-store'
import { InfraHome } from './InfraHome'

/** Covers the workbench body (terminals keep running beneath) while the Infra section is chosen. */
export function InfraHomeOverlay({
  worktreeId,
  groupId
}: {
  worktreeId: string
  groupId: string
}): React.JSX.Element | null {
  const open = useInfraHomeOpen(worktreeId)
  const isWorkbench = useAppStore(() => workbenchGroupId(worktreeId) === groupId)
  const inspection = useDevopsInspection(worktreeId)
  const activeTabId = useAppStore(
    (state) =>
      state.groupsByWorktree[worktreeId]?.find((group) => group.id === groupId)?.activeTabId
  )
  const seenTab = useRef(activeTabId)
  useEffect(() => {
    // Every workspace starts here once, so the Launchpad is the first thing a new project shows.
    if (isWorkbench && inspection) {
      openInfraHomeOnce(worktreeId)
    }
  }, [inspection, isWorkbench, worktreeId])
  useEffect(() => {
    // Picking a tab in this group means the person wants that tab, not the Infra home.
    if (seenTab.current !== activeTabId) {
      seenTab.current = activeTabId
      if (isWorkbench) {
        setInfraHomeOpen(worktreeId, false)
      }
    }
  }, [activeTabId, isWorkbench, worktreeId])
  return open && isWorkbench ? <InfraHome worktreeId={worktreeId} /> : null
}
