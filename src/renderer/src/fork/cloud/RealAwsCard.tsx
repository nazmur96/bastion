import { getIntlLocale } from '@/i18n/i18n'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { CloudTarget } from '../../../../shared/fork-cloud/cloud-target-contract'
import { realAwsMessages } from '../../../../shared/fork-cloud/real-aws-contract'
import type { RealCloudState } from './real-cloud-actions'
import { cloudConnections } from './cloud-connections-state'
export function RealAwsCard({
  target,
  state,
  pending
}: {
  target: CloudTarget
  state: RealCloudState | null | undefined
  pending: boolean
}): React.JSX.Element | null {
  const [accepting, setAccepting] = useState(false)
  if (target.configuration.kind !== 'real') {
    return null
  }
  const config = target.configuration,
    identity = state?.identity
  return (
    <section className="workspace-card space-y-4" data-testid="real-aws-target">
      <div className="flex flex-wrap items-center gap-3">
        <h2>{target.label}</h2>
        <Badge variant="outline">Real AWS</Badge>
      </div>
      <p className="text-sm">
        {config.profileName} · {config.region}
      </p>
      <p className="text-sm">
        Real account access · fixed read-only operations. Authentication uses your own profile;
        credentials stay with its provider.
      </p>
      <p className="text-sm">
        {identity
          ? `Last observed ${new Date(identity.checkedAt).toLocaleString(getIntlLocale())}`
          : 'Not verified'}
      </p>
      {config.expectedAccountId && (
        <p className="text-xs">
          Expected account: {config.expectedAccountId}
          {config.expectedRoleArn ? ` · ${config.expectedRoleArn}` : ' · account anchor only'}
        </p>
      )}
      {identity && (
        <div className="space-y-1 break-all text-xs">
          <p>Observed account: {identity.accountId}</p>
          <p>{identity.arn}</p>
          <p>
            {identity.roleArn ??
              'IAM role path not verified; accepting stores an account anchor only.'}
          </p>
          <p>AWS CLI {identity.toolVersion} · credential expiration unknown</p>
        </div>
      )}
      {state?.error && (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={pending}
          onClick={() => {
            void cloudConnections.realAction('verify')
          }}
        >
          Verify real AWS
        </Button>
        {identity && !identity.anchored && (
          <Button variant="outline" disabled={pending} onClick={() => setAccepting(true)}>
            Use this identity for this target
          </Button>
        )}
        <Button
          variant="outline"
          disabled={pending || !identity?.anchored}
          onClick={() => {
            void cloudConnections.realAction('resources')
          }}
        >
          Read resources
        </Button>
        <Button
          variant="outline"
          disabled={pending || !identity?.anchored}
          onClick={() => {
            void cloudConnections.realAction('budgets')
          }}
        >
          Read budgets
        </Button>
      </div>
      {state?.resources && (
        <div className="space-y-3 text-xs" aria-label="Real AWS resources">
          <p>
            Observed {new Date(state.resources.at).toLocaleString(getIntlLocale())} · S3 buckets are
            global; other lists use {config.region}.
          </p>
          {state.resources.results.map((result) => (
            <div key={result.service}>
              <p className="font-medium">
                {result.service}:{' '}
                {result.status === 'ok'
                  ? result.items.length
                    ? `${result.items.length} listed`
                    : 'No resources found in this response'
                  : realAwsMessages[result.status]}
                {result.truncated ? ' · incomplete' : ''}
              </p>
              <ul>
                {result.items.map((item, index) => (
                  <li className="break-all" key={`${item.arn ?? item.name}:${index}`}>
                    {item.name}
                    {item.arn ? ` · ${item.arn}` : ''}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
      {state?.budgets && (
        <div className="space-y-1 text-xs" aria-label="Real AWS budgets">
          <p>
            Budget status: {state.budgets.status} · observed{' '}
            {new Date(state.budgets.at).toLocaleString(getIntlLocale())}
          </p>
          <p>
            {state.budgets.accountWide
              ? 'Account-wide alert observed'
              : 'Full account alert coverage is not confirmed'}{' '}
            · {state.budgets.alerts} alert(s){state.budgets.truncated ? ' · incomplete' : ''}
          </p>
          <p>
            A budget is not a spending cap. Missing or denied evidence does not mean zero spend.
          </p>
        </div>
      )}
      <div className="space-y-2 border-t border-border pt-3" data-testid="real-aws-costs">
        <h3>Cost Explorer</h3>
        <p className="text-xs">
          Not requested · May incur AWS API charges. Cost Explorer is disabled in this version.
        </p>
        <Button variant="outline" disabled>
          Fetch Cost Explorer data
        </Button>
      </div>
      {accepting && identity && (
        <Dialog open onOpenChange={setAccepting}>
          <DialogContent surface="security">
            <DialogHeader>
              <DialogTitle>Accept this real AWS identity?</DialogTitle>
            </DialogHeader>
            <p className="break-all text-sm">
              Store the expectation for {target.label}: account {identity.accountId}, profile{' '}
              {config.profileName}, region {config.region}.{' '}
              {identity.roleArn ??
                'Only the account will be anchored; an IAM role path is not verified.'}{' '}
              No credentials are stored.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setAccepting(false)}>
                Cancel
              </Button>
              <Button
                disabled={pending}
                onClick={() => {
                  setAccepting(false)
                  void cloudConnections.realAction('accept')
                }}
              >
                Confirm identity
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </section>
  )
}
