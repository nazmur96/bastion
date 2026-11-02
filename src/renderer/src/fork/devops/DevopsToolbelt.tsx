import { useDevopsInspection } from './use-devops-inspection'
import { useDevopsSandbox } from './use-devops-sandbox'
import { DevopsContextBar } from './DevopsContextBar'
import type { DevopsStack } from '../../../../shared/fork-devops-stacks'

/** The workbench strip keeps only where commands land; actions and the sandbox live on the Infra home. */
export function DevopsToolbelt({ worktreeId }: { worktreeId: string }): React.JSX.Element | null {
  const inspection = useDevopsInspection(worktreeId)
  const sandbox = useDevopsSandbox(worktreeId)
  if (!inspection || inspection.findings.length === 0) {
    return null
  }
  const has = (...stacks: DevopsStack[]) =>
    inspection.findings.some((finding) => stacks.includes(finding.stack))
  return (
    <div className="ml-1 flex min-w-0 items-center" data-devops-toolbelt="">
      <DevopsContextBar
        worktreeId={worktreeId}
        show={{
          kube: has('kubernetes', 'helm', 'argocd'),
          aws: has('aws', 'terraform'),
          terraform: has('terraform')
        }}
        terraformDir={
          inspection.findings.find((finding) => finding.stack === 'terraform')?.dirs[0] ?? null
        }
        refreshKey={JSON.stringify(sandbox.state)}
      />
    </div>
  )
}
