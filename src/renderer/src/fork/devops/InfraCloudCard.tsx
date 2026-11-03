import { useCallback, useEffect, useState } from 'react'
import { CircleAlert, CircleCheck, Cloud, RefreshCw, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import { runInWorkbenchTerminal } from '../workbench/workbench-terminals'
import { draftForClaude } from './ask-claude'
import { InfraCard } from './InfraHomeCards'
import { scaffoldPlatformPrompt, type CloudReadiness } from '../../../../shared/fork-devops-cloud'

function Row({
  ok,
  children
}: {
  ok: boolean | null
  children: React.ReactNode
}): React.JSX.Element {
  const Icon = ok ? CircleCheck : CircleAlert
  return (
    <li className="flex items-start gap-2 text-sm">
      <Icon
        className={cn(
          'mt-0.5 size-4 shrink-0',
          ok
            ? 'text-status-success'
            : ok === false
              ? 'text-status-warning'
              : 'text-muted-foreground'
        )}
        aria-hidden
      />
      <span className="min-w-0">{children}</span>
    </li>
  )
}

/** Path stage 5, first half: who and where in AWS, and the platform code, before any plan. */
export function InfraCloudCard({
  worktreeId,
  workspacePath,
  appName,
  hasTerraform,
  platformFolder
}: {
  worktreeId: string
  workspacePath: string
  appName: string
  /** The project already has Terraform (here or in the confirmed infrastructure repo). */
  hasTerraform: boolean
  /** Where Claude should write the platform: the infrastructure sibling, else `platform` here. */
  platformFolder: string
}): React.JSX.Element {
  const [readiness, setReadiness] = useState<CloudReadiness | { error: string } | null>(null)
  const check = useCallback(() => {
    setReadiness(null)
    void window.api.aiVault.cloudReadiness(workspacePath).then(setReadiness)
  }, [workspacePath])
  useEffect(check, [check])

  const ready = readiness && 'identity' in readiness ? readiness : null
  const signedIn = ready !== null && 'account' in ready.identity
  const region = ready?.region ?? 'eu-central-1'

  return (
    <InfraCard
      id="infra-path-cloud"
      className="mb-4"
      title={translate('components.devops.cloud.title', 'Cloud · who and where')}
      hint={translate(
        'components.devops.cloud.hint',
        'Checked before anything is planned. These calls only read; nothing is created.'
      )}
    >
      {!readiness ? (
        <p className="text-xs text-muted-foreground">
          {translate('components.devops.cloud.checking', 'Asking AWS who you are…')}
        </p>
      ) : !ready ? (
        <p className="text-xs text-destructive">{'error' in readiness ? readiness.error : ''}</p>
      ) : (
        <ul className="space-y-1.5">
          <Row ok={signedIn}>
            {'account' in ready.identity ? (
              <>
                {ready.local
                  ? translate(
                      'components.devops.cloud.local',
                      'Local AWS (Floci), account {{account}}',
                      {
                        account: ready.identity.account
                      }
                    )
                  : translate('components.devops.cloud.account', 'Account {{account}} as {{arn}}', {
                      account: ready.identity.account,
                      arn: ready.identity.arn.split('/').slice(-2).join('/')
                    })}
              </>
            ) : (
              <>
                {translate(
                  'components.devops.cloud.notSignedIn',
                  'Not signed in ({{profile}}): {{error}}',
                  {
                    profile: ready.profile,
                    error: ready.identity.error
                  }
                )}
              </>
            )}
          </Row>
          <Row ok={ready.region !== null}>
            {ready.region
              ? translate('components.devops.cloud.region', 'Region {{region}}', {
                  region: ready.region
                })
              : translate(
                  'components.devops.cloud.noRegion',
                  'No region set for profile {{profile}}',
                  {
                    profile: ready.profile
                  }
                )}
          </Row>
          {signedIn && !ready.local ? (
            <Row ok={ready.budgets === null ? null : ready.budgets > 0}>
              {ready.budgets === null
                ? translate(
                    'components.devops.cloud.budgetUnknown',
                    'Budgets could not be read (needs budgets:ViewBudget).'
                  )
                : ready.budgets > 0
                  ? translate(
                      'components.devops.cloud.budgets',
                      '{{count}} budget alert(s) in place',
                      {
                        count: ready.budgets
                      }
                    )
                  : translate(
                      'components.devops.cloud.noBudget',
                      'No budget alert yet: add one before creating anything.'
                    )}
            </Row>
          ) : null}
          {ready.staticKeys ? (
            <Row ok={false}>
              {translate(
                'components.devops.cloud.staticKeys',
                'Using long-lived access keys. Keyless sign-in (SSO or federated) is safer.'
              )}
            </Row>
          ) : null}
        </ul>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {ready && !signedIn ? (
          <Button
            type="button"
            size="xs"
            title={ready.signIn}
            onClick={() => runInWorkbenchTerminal(worktreeId, ready.signIn)}
          >
            <Cloud aria-hidden />
            {translate('components.devops.cloud.signIn', 'Sign in ({{profile}})', {
              profile: ready.profile
            })}
          </Button>
        ) : null}
        {!hasTerraform ? (
          <Button
            type="button"
            size="xs"
            variant="outline"
            onClick={() =>
              draftForClaude(
                worktreeId,
                scaffoldPlatformPrompt({ folder: platformFolder, region, appName })
              )
            }
          >
            <Sparkles aria-hidden />
            {translate('components.devops.cloud.scaffold', 'Write the platform with Claude')}
          </Button>
        ) : null}
        <Button type="button" size="xs" variant="ghost" onClick={check}>
          <RefreshCw aria-hidden />
          {translate('components.devops.cloud.recheck', 'Check again')}
        </Button>
      </div>
    </InfraCard>
  )
}
