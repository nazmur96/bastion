import { Check, FolderGit2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { InfraCard } from './InfraHomeCards'
import type { DevopsProject } from './use-devops-project'
import type { ProjectRole } from '../../../../shared/fork-devops-project'

function roleLabel(role: ProjectRole): string {
  switch (role) {
    case 'app':
      return translate('components.devops.project.app', 'app')
    case 'gitops':
      return translate('components.devops.project.gitops', 'GitOps')
    case 'platform':
      return translate('components.devops.project.platform', 'infrastructure')
  }
}

/** Asks once whether the sibling repos are one project; afterwards shows what the stages use. */
export function InfraProjectCard({
  project
}: {
  project: DevopsProject
}): React.JSX.Element | null {
  if (project.proposal.length < 2) {
    return null
  }
  const pending = project.decision === null
  const shown = pending ? project.proposal : project.members
  return (
    <InfraCard
      className="mb-4"
      title={
        pending
          ? translate('components.devops.project.ask', 'These look like one project')
          : translate('components.devops.project.title', 'This project')
      }
      hint={
        pending
          ? translate(
              'components.devops.project.askHint',
              'Each step then uses the right repo: manifests from GitOps, Terraform from infrastructure.'
            )
          : undefined
      }
    >
      <ul className="flex flex-wrap gap-2">
        {shown.map((member) => (
          <li
            key={member.repo.path}
            className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-sm"
            title={member.repo.remote ?? member.repo.path}
          >
            <FolderGit2 className="size-3.5 text-muted-foreground" aria-hidden />
            <span className="font-mono text-xs">{member.repo.folder}</span>
            <span className="text-xs text-muted-foreground">{roleLabel(member.role)}</span>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex items-center gap-2">
        {pending ? (
          <>
            <Button type="button" size="xs" onClick={project.confirm}>
              <Check aria-hidden />
              {translate('components.devops.project.confirm', 'Yes, one project')}
            </Button>
            <Button type="button" size="xs" variant="ghost" onClick={project.keepSingle}>
              {translate('components.devops.project.single', 'No, just this repo')}
            </Button>
          </>
        ) : (
          <Button type="button" size="xs" variant="ghost" onClick={project.reset}>
            {translate('components.devops.project.change', 'Change')}
          </Button>
        )}
      </div>
    </InfraCard>
  )
}
