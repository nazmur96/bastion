import { Check } from 'lucide-react'
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
        command: 'path:harden',
        card: 'infra-path-harden'
      }
    case 'cloud':
      return {
        title: translate('components.devops.path.next.cloud', 'Create the cloud environment'),
        hint: translate(
          'components.devops.path.next.cloudHint',
          'Sign in, write or review the platform, then plan: cost, policy and your approval before anything is billed.'
        ),
        button: translate('components.devops.path.show', 'Show me'),
        command: null,
        card: 'infra-path-cloud'
      }
    case 'ship':
      return {
        title: translate('components.devops.path.next.ship', 'Ship it to the cloud cluster'),
        hint: translate(
          'components.devops.path.next.shipHint',
          'Connect kubectl to EKS, then the same Argo CD deploy, confirmed for the real cluster.'
        ),
        button: translate('components.devops.path.show', 'Show me'),
        command: null,
        card: 'infra-path-cloud'
      }
  }
}

/** Opens the card behind a step: it lives in the Tools view, inside a folded section. */
/** Cards that stay loaded but are never shown; a step pointing at one goes to Claude. */
const HIDDEN_CARDS = new Set(['infra-path-launchpad'])

export function scrollToInfraCard(card: string): void {
  const element = card ? document.getElementById(card) : null
  const section = element?.closest('details')
  if (section) {
    section.open = true
  }
  element?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

/** Path step 4: where the project is, and the next step as the one main button. */
export function InfraPathStepper({
  worktreeId,
  stages,
  members,
  onUnderstood,
  onShowCard
}: {
  worktreeId: string
  stages: PathStage[]
  members: ProjectMember[]
  onUnderstood: () => void
  /** Switches to the Tools view and scrolls to the card; false when that card is not shown. */
  onShowCard: (card: string) => boolean
}): React.JSX.Element {
  const commands = useAllDeckCommands()
  const next = stages.find((stage) => stage.state === 'next')
  const step = next ? nextStep(next.id) : null
  const available = step?.command ? commands.find((command) => command.id === step.command) : null
  // The tool behind the step is missing: adding it is the step until it is there.
  const setup =
    !available && step?.command?.startsWith('launch:')
      ? commands.find((command) => command.id === step.command?.replace('launch:', 'setup:'))
      : null

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
    const action = available ?? setup
    if (action) {
      action.run()
      return
    }
    if (!onShowCard(step.card)) {
      // Nothing on screen does this step yet: Claude does it, showing each command first.
      draftForClaude(worktreeId, `${step.title}. ${step.hint}`)
    }
  }

  const nextIndex = stages.findIndex((stage) => stage.state === 'next')
  const label =
    !next || !step
      ? ''
      : next.id === 'understand' || available
        ? step.button
        : setup
          ? setup.label
          : HIDDEN_CARDS.has(step.card)
            ? translate('components.devops.path.askClaude', 'Ask Claude to do it')
            : translate('components.devops.path.show', 'Show me')
  const doneCount = stages.filter((stage) => stage.state === 'done').length
  return (
    <>
      <div className="bx-pathcol-head">
        <b>{translate('components.devops.path.title', 'Project path')}</b>
        <span>
          {translate('components.devops.path.progress', '{{done}} of {{total}}', {
            done: doneCount,
            total: stages.length
          })}
        </span>
      </div>
      <ol className="bx-vsteps" data-project-path="">
        {stages.map((stage, index) =>
          stage.state === 'next' && step ? (
            <li key={stage.id} className="bx-vstep active">
              <div className="row">
                <span className="i" />
                <span>{stageLabel(stage.id)}</span>
                <span className="n">
                  {translate('components.devops.path.stepOf', 'Step {{n}} of {{total}}', {
                    n: index + 1,
                    total: stages.length
                  })}
                </span>
              </div>
              <div className="h">{step.title}</div>
              <div className="s">{step.hint}</div>
              <button type="button" className="bx-btn" onClick={go}>
                {label}
              </button>
            </li>
          ) : (
            <li key={stage.id}>
              <button
                type="button"
                className={cn('bx-vstep', stage.state === 'done' && 'done')}
                disabled={stage.state === 'coming'}
                title={
                  stage.state === 'coming'
                    ? translate('components.devops.path.coming', 'Coming next')
                    : undefined
                }
                onClick={() => {
                  const card = nextStep(stage.id).card
                  if (card) {
                    onShowCard(card)
                  }
                }}
              >
                <span className="i">
                  {stage.state === 'done' ? <Check className="size-2.5" aria-hidden /> : null}
                </span>
                <span>{stageLabel(stage.id)}</span>
              </button>
            </li>
          )
        )}
      </ol>
      {nextIndex === -1 ? (
        <p className="bx-pathcol-done">
          {translate(
            'components.devops.path.localDone',
            'The local path is complete. The cloud steps (EKS, ship) are coming next.'
          )}
        </p>
      ) : null}
    </>
  )
}
