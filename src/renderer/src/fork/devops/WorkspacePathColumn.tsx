import { useAppStore } from '@/store'
import { selectKnownWorktreeById } from '@/store/selectors'
import { useBastionLayout } from '../workbench/use-bastion-layout'
import { InfraHome } from './InfraHome'

/** The active workspace's Project path, as a column at the left of the workbench. */
export function WorkspacePathColumn(): React.JSX.Element | null {
  const worktreeId = useAppStore((state) =>
    state.activeWorktreeId && selectKnownWorktreeById(state, state.activeWorktreeId)
      ? state.activeWorktreeId
      : null
  )
  return worktreeId ? <PathColumn key={worktreeId} worktreeId={worktreeId} /> : null
}

function PathColumn({ worktreeId }: { worktreeId: string }): React.JSX.Element {
  useBastionLayout(worktreeId)
  return <InfraHome worktreeId={worktreeId} />
}
