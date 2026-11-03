import { InfraRadarFindings } from './InfraRadarFindings'
import { InfraDocsCards } from './InfraDocsCards'
import type { DevopsContext } from '../../../../shared/fork-devops-context'

/** The Infra home's day-2 section: Radar's view, runbooks, the tracker and the later modes. */
export function InfraExtras({
  worktreeId,
  workspacePath,
  context,
  clusterAnswers,
  appName
}: {
  worktreeId: string
  workspacePath: string
  appName: string
  context: DevopsContext
  clusterAnswers: boolean
}): React.JSX.Element {
  return (
    <>
      {context.kube && clusterAnswers ? (
        <InfraRadarFindings
          key={context.kube.context}
          worktreeId={worktreeId}
          workspacePath={workspacePath}
          context={context.kube.context}
        />
      ) : null}
      <InfraDocsCards worktreeId={worktreeId} workspacePath={workspacePath} appName={appName} />
    </>
  )
}
