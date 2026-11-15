import { getIntlLocale } from '@/i18n/i18n'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { RealCloudState } from './real-cloud-actions'
import { costTotal } from '../../../../shared/fork-cloud/cloud-cost-view'
import { cloudConnections } from './cloud-connections-state'

/** Cost Explorer is billed per request: nothing is fetched until a target-specific confirmation. */
export function RealAwsCostSection({
  state,
  pending,
  eligible
}: {
  state: RealCloudState | null | undefined
  pending: boolean
  eligible: boolean
}): React.JSX.Element {
  const cost = state?.cost,
    challenge = state?.challenge,
    total = cost?.data ? costTotal(cost.data.results) : null
  return (
    <div className="space-y-2 border-t border-border pt-3" data-testid="real-aws-costs">
      <h3>Cost Explorer</h3>
      {!cost && (
        <p className="text-xs">
          Not requested · May incur AWS API charges. Each confirmed read makes one Cost Explorer
          request; nothing is fetched automatically.
        </p>
      )}
      {cost?.data && (
        <div className="space-y-1 text-xs" aria-label="Real AWS costs">
          <p>
            Observed{' '}
            {cost.observedAt ? new Date(cost.observedAt).toLocaleString(getIntlLocale()) : ''} ·
            account {cost.accountId} · unblended cost, current UTC month to date
          </p>
          <p className="font-medium">Observed cost data (not an invoice)</p>
          {total ? (
            <p>
              {total.label}: {total.amount} {total.unit}
              {total.label === 'Estimated total' ? ' · AWS may still revise estimated days' : ''}
            </p>
          ) : (
            cost.data.results.length > 0 && <p>No single total: the rows use different units.</p>
          )}
          {cost.data.results.length === 0 && <p>No cost rows were returned for this period.</p>}
          <ul>
            {cost.data.results.map((row) => (
              <li key={`${row.start}:${row.end}`}>
                {row.start} to {row.end}: {row.amount} {row.unit}
                {row.estimated ? ' · Estimated' : ''}
              </li>
            ))}
          </ul>
          {cost.data.moreAvailable && (
            <p>More data exists; another confirmed read would be needed to fetch it.</p>
          )}
          <p>Not a spending cap.</p>
        </div>
      )}
      {cost && !cost.data && (
        <p className="text-xs">
          Request {cost.status}. {cost.status === 'unknown' ? 'It may have been charged.' : ''}
        </p>
      )}
      {state?.costError && (
        <p role="alert" className="text-sm text-destructive">
          {state.costError}
        </p>
      )}
      <Button
        variant="outline"
        disabled={pending || !eligible}
        onClick={() => {
          void cloudConnections.realAction('cost-prepare')
        }}
      >
        Fetch Cost Explorer data
      </Button>
      {challenge && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) {
              void cloudConnections.realAction('cost-cancel')
            }
          }}
        >
          <DialogContent surface="security">
            <DialogHeader>
              <DialogTitle>Make a paid Cost Explorer request?</DialogTitle>
            </DialogHeader>
            <div className="space-y-1 break-all text-sm">
              <p>
                Account {challenge.accountId} · profile {challenge.profileName}
              </p>
              <p>{challenge.principalArn}</p>
              <p>
                {challenge.query.Granularity} · {challenge.query.Metrics[0]} · linked account{' '}
                {challenge.query.Filter.Dimensions.Values[0]} only
              </p>
              <p>
                {challenge.query.TimePeriod.Start} to {challenge.query.TimePeriod.End} (UTC, end
                exclusive) · billing endpoint {challenge.endpointRegion}
              </p>
              <p>
                May incur AWS API charges. AWS bills each Cost Explorer API request; see the AWS
                Cost Explorer pricing page. One request is made, with no automatic retry.
              </p>
            </div>
            <div className="flex justify-end gap-2">
              <Button
                variant="ghost"
                onClick={() => {
                  void cloudConnections.realAction('cost-cancel')
                }}
              >
                Cancel
              </Button>
              <Button
                disabled={pending}
                onClick={() => {
                  void cloudConnections.realAction('cost-confirm')
                }}
              >
                Confirm paid read
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}
