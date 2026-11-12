import { getKnownExecutionHostIdForWorktree } from '@/lib/worktree-runtime-owner'
import { useAppStore } from '@/store'
import { selectKnownWorktreeById } from '@/store/selectors'
import { useBastionLayout } from '../workbench/use-bastion-layout'
import { InfraHome } from './InfraHome'
import { RemoteInfraOverlay } from './RemoteInfraTools'
import { isIncognitoWindow } from '../project-workspaces/use-project-workspaces'

/** The active workspace's Project path, as a column at the left of the workbench. */
export function WorkspacePathColumn(): React.JSX.Element | null {
  const worktreeId = useAppStore((state) =>
    state.activeWorktreeId && selectKnownWorktreeById(state, state.activeWorktreeId)
      ? state.activeWorktreeId
      : null
  )
  return worktreeId && !isIncognitoWindow() ? (
    <PathColumn key={worktreeId} worktreeId={worktreeId} />
  ) : null
}

function PathColumn({ worktreeId }: { worktreeId: string }): React.JSX.Element | null {
  useBastionLayout(worktreeId)
  const local = useAppStore(
    (state) => getKnownExecutionHostIdForWorktree(state, worktreeId) === 'local'
  )
  // The local path column inspects this machine; other owners get only their own read-through view.
  return local ? (
    <InfraHome worktreeId={worktreeId} />
  ) : (
    <RemoteInfraOverlay worktreeId={worktreeId} />
  )
}
