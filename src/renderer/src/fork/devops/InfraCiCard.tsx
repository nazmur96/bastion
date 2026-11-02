import { CircleCheck, CircleDashed, CircleX, ListChecks } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/store'
import { translate } from '@/i18n/i18n'
import { getActiveChecksStatus } from '@/components/right-sidebar/active-checks-status'
import { InfraCard } from './InfraHomeCards'
import type { CheckStatus } from '../../../../shared/github/pull-request-types'

const STATUS: Record<CheckStatus, { icon: typeof CircleCheck; className: string }> = {
  success: { icon: CircleCheck, className: 'text-status-success' },
  failure: { icon: CircleX, className: 'text-destructive' },
  pending: { icon: CircleDashed, className: 'text-status-warning' },
  neutral: { icon: CircleDashed, className: 'text-muted-foreground' }
}

function label(status: CheckStatus): string {
  switch (status) {
    case 'success':
      return translate('components.devops.ci.success', 'All checks passed')
    case 'failure':
      return translate('components.devops.ci.failure', 'Checks failing')
    case 'pending':
      return translate('components.devops.ci.pending', 'Checks running')
    case 'neutral':
      return translate('components.devops.ci.neutral', 'No result yet')
  }
}

/** B3: this branch's pipeline at a glance; the logs and Fix with AI live in Orca's checks panel. */
export function InfraCiCard(): React.JSX.Element {
  const status = useAppStore(getActiveChecksStatus)
  const openChecks = (): void => {
    const store = useAppStore.getState()
    store.setRightSidebarTab('checks')
    store.setRightSidebarOpen(true)
  }
  const shown = status ? STATUS[status] : null
  const Icon = shown?.icon ?? ListChecks
  return (
    <InfraCard
      title={translate('components.devops.ci.title', 'Pipeline')}
      hint={translate(
        'components.devops.ci.hint',
        'CI on this branch’s pull request. Failed steps open with their logs and a fix.'
      )}
    >
      <div className="flex items-center gap-2 text-sm">
        <Icon
          className={cn('size-4 shrink-0', shown?.className ?? 'text-muted-foreground')}
          aria-hidden
        />
        <span className={shown?.className}>
          {status
            ? label(status)
            : translate('components.devops.ci.noPr', 'No pull request for this branch yet')}
        </span>
        <Button
          type="button"
          size="xs"
          variant={status === 'failure' ? 'default' : 'outline'}
          className="ml-auto"
          onClick={openChecks}
        >
          {status === 'failure'
            ? translate('components.devops.ci.fix', 'See failures and fix')
            : translate('components.devops.ci.open', 'Open checks')}
        </Button>
      </div>
    </InfraCard>
  )
}
