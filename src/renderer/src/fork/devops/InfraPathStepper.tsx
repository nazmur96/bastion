import { Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import { draftForClaude } from './ask-claude'
import { useAllDeckCommands } from './command-deck-store'
import type { ProjectMember } from '../../../../shared/fork-devops-project'
import type { PathStage, PathStageId } from '../../../../shared/fork-devops-path'

function stageLabel(id: PathStageId): string {
  switch (id) {
    case 'understand':
      return translate('components.devops.path.understand', 'Understood')
    case 'cluster':
      return translate('components.devops.path.cluster', 'Local cluster')
    case 'app':
      return translate('components.devops.path.app', 'App running')
    case 'gitops':
      return translate('components.devops.path.gitops', 'GitOps')
    case 'harden':
      return translate('components.devops.path.harden', 'Hardened')
    case 'cloud':
      return translate('components.devops.path.cloud', 'Cloud')
    case 'ship':
      return translate('components.devops.path.ship', 'Shipped')
  }
}

type NextStep = {
  title: string
  hint: string
  button: string
  command: string | null
  card: string
}

function nextStep(id: PathStageId): NextStep {
  switch (id) {
    case 'understand':
      return {
        title: translate('components.devops.path.next.understand', 'Understand the app'),
        hint: translate(
          'components.devops.path.next.understandHint',
          'Claude reads the project and explains what it needs before anything runs.'
        ),
        button: translate('components.devops.path.next.understandButton', 'Explain it'),
        command: null,
        card: ''
      }
    case 'cluster':
      return {
        title: translate('components.devops.path.next.cluster', 'Start a local cluster'),
        hint: translate(
          'components.devops.path.next.clusterHint',
          'kind with metrics-server, on this machine, free.'
        ),
        button: translate('components.devops.path.next.clusterButton', 'Create kind cluster'),
        command: 'launch:kind',
        card: 'infra-path-launchpad'
      }
    case 'app':
      return {
        title: translate('components.devops.path.next.app', 'Run this app on the cluster'),
        hint: translate(
          'components.devops.path.next.appHint',
          'Build the image, load it, deploy your own manifests.'
        ),
        button: translate('components.devops.path.next.appButton', 'Build and run'),
        command: 'path:app',
        card: 'infra-path-app'
      }
    case 'gitops':
      return {
        title: translate('components.devops.path.next.gitops', 'Deploy it with Argo CD'),
        hint: translate(
          'components.devops.path.next.gitopsHint',
          'From then on the cluster follows the pushed repo.'
        ),
        button: translate('components.devops.path.next.gitopsButton', 'Deploy with Argo CD'),
        command: 'path:gitops',
        card: 'infra-path-gitops'
      }
    case 'harden':
      return {
        title: translate('components.devops.path.next.harden', 'Scan it for risks'),
        hint: translate(
          'components.devops.path.next.hardenHint',
          'Trivy over the repo: misconfigurations in manifests, Terraform and Dockerfiles.'
        ),
        button: translate('components.devops.path.next.hardenButton', 'Scan'),
        command: 'launch:trivy',
        card: 'infra-path-launchpad'
      }
    case 'cloud':
    case 'ship':
      return { title: '', hint: '', button: '', command: null, card: '' }
  }
}

function scrollTo(card: string): void {
  if (card) {
    document.getElementById(card)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
}

/** Path step 4: where the project is, and the next step as the one main button. */
export function InfraPathStepper({
  worktreeId,
  stages,
  members,
  onUnderstood,
  onHardened
}: {
  worktreeId: string
  stages: PathStage[]
  members: ProjectMember[]
  onUnderstood: () => void
  onHardened: () => void
}): React.JSX.Element {
  const commands = useAllDeckCommands()
  const next = stages.find((stage) => stage.state === 'next')
  const step = next ? nextStep(next.id) : null
  const available = step?.command ? commands.find((command) => command.id === step.command) : null

  const go = (): void => {
    if (!next || !step) {
      return
    }
    if (next.id === 'understand') {
      const repos = members.map((member) => `${member.repo.folder} (${member.role})`).join(', ')
      draftForClaude(
        worktreeId,
        `Explain this project: ${repos}. What it is, what it needs to run (env vars, ports, databases, other services), where its manifests and infrastructure live, and what is missing for running it on Kubernetes (probes, resource limits, secrets). Read the files only; change nothing.`
      )
      onUnderstood()
      return
    }
    if (available) {
      available.run()
      if (next.id === 'harden') {
        onHardened()
      }
      return
    }
    scrollTo(step.card)
  }

  return (
    <section className="mb-4" data-project-path="">
      <ol className="mb-3 flex gap-1.5 overflow-x-auto scrollbar-sleek">
        {stages.map((stage) => {
          const card = nextStep(stage.id).card
          return (
            <li key={stage.id} className="min-w-0 flex-1">
              <button
                type="button"
                disabled={stage.state === 'coming'}
                onClick={() => scrollTo(card)}
                title={
                  stage.state === 'coming'
                    ? translate('components.devops.path.coming', 'Coming next')
                    : undefined
                }
                className={cn(
                  'flex w-full items-center gap-1.5 rounded-md border px-2 py-1.5 text-xs whitespace-nowrap',
                  stage.state === 'done' && 'border-border text-foreground',
                  stage.state === 'next' && 'border-primary text-foreground ring-1 ring-primary',
                  stage.state === 'todo' && 'border-border text-muted-foreground',
                  stage.state === 'coming' &&
                    'border-dashed border-border text-muted-foreground opacity-60'
                )}
              >
                <span
                  className={cn(
                    'grid size-4 shrink-0 place-items-center rounded-full border',
                    stage.state === 'done'
                      ? 'border-status-success bg-status-success text-background'
                      : 'border-current'
                  )}
                >
                  {stage.state === 'done' ? <Check className="size-3" aria-hidden /> : null}
                </span>
                <span className="truncate">{stageLabel(stage.id)}</span>
              </button>
            </li>
          )
        })}
      </ol>
      {next && step ? (
        <div className="flex items-center gap-4 rounded-lg border border-primary/40 bg-primary/5 p-4">
          <div className="min-w-0 flex-1">
            <div className="text-xs font-medium uppercase tracking-wide text-primary">
              {translate('components.devops.path.nextLabel', 'Next step')}
            </div>
            <div className="text-base font-semibold">{step.title}</div>
            <div className="text-xs text-muted-foreground">{step.hint}</div>
          </div>
          <Button type="button" onClick={go}>
            {next.id !== 'understand' && !available
              ? translate('components.devops.path.show', 'Show me')
              : step.button}
          </Button>
        </div>
      ) : (
        <p className="rounded-lg border border-border p-3 text-sm text-muted-foreground">
          {translate(
            'components.devops.path.localDone',
            'The local path is complete. The cloud steps (EKS, ship) are coming next.'
          )}
        </p>
      )}
    </section>
  )
}
