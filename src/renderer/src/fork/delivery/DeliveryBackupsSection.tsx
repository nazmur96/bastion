import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { getIntlLocale } from '@/i18n/i18n'
import { capabilityNote } from '../../../../shared/fork-cloud/operation-capabilities'
import type { DeliveryConfig } from '../../../../shared/fork-delivery/delivery-contract'
import type {
  BackupEvidence,
  BackupFinding
} from '../../../../shared/fork-delivery/backup-contract'
import { ownerOperation } from './operations-owner-client'

const input = 'rounded-md border border-input bg-background px-2 py-1 font-mono text-sm'

function Finding({ finding }: { finding: BackupFinding }): React.JSX.Element {
  return (
    <li className="font-mono text-xs break-all" data-backup={finding.subject}>
      <Badge variant={finding.status === 'verified' ? 'secondary' : 'outline'}>
        {finding.status}
      </Badge>{' '}
      {finding.source} · {finding.subject} · {finding.detail}
    </li>
  )
}

/** Fork: Step 14.4 read-only backup evidence: Velero in the cluster and the last restore drill. */
export function DeliveryBackupsSection({
  config
}: {
  config: DeliveryConfig | null
}): React.JSX.Element {
  const [veleroNamespace, setVeleroNamespace] = useState('velero')
  const [staleHours, setStaleHours] = useState('26')
  const [drillDays, setDrillDays] = useState('90')
  const [evidence, setEvidence] = useState<BackupEvidence | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const hours = Number(staleHours)
  const days = Number(drillDays)
  const valid =
    /^[a-z0-9]([-a-z0-9]{0,61}[a-z0-9])?$/.test(veleroNamespace) &&
    Number.isInteger(hours) &&
    hours >= 1 &&
    hours <= 744 &&
    Number.isInteger(days) &&
    days >= 1 &&
    days <= 365
  const read = async (): Promise<void> => {
    if (!config || !valid) {
      return
    }
    setBusy(true)
    setError(null)
    setEvidence(null)
    try {
      const request = {
        ...config,
        veleroNamespace,
        staleHours: hours,
        drillDays: days
      }
      const result = await ownerOperation(
        config.projectId,
        'operations.backups',
        request,
        async () => window.api.cloudTargets?.operations?.backups(request)
      )
      if (result?.ok) {
        setEvidence(result.evidence)
      } else {
        setError(result?.message ?? 'Backup evidence is unavailable in this client.')
      }
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="workspace-card space-y-3" data-testid="delivery-backups">
      <div>
        <h2 className="text-sm font-medium">Backups</h2>
        <p className="text-xs text-muted-foreground">
          Velero backups and schedules covering the application&apos;s namespace, and the latest
          recorded drill of a restore runbook. Read-only. A stale, failed or missing backup is a
          mismatch; an unreadable source is unknown. Database backups are read on the AWS target.
        </p>
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        <label className="flex flex-col gap-1 text-xs">
          Velero namespace
          <input
            className={input}
            value={veleroNamespace}
            onChange={(event) => setVeleroNamespace(event.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          Stale after (hours)
          <input
            className={input}
            value={staleHours}
            onChange={(event) => setStaleHours(event.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          Drill due after (days)
          <input
            className={input}
            value={drillDays}
            onChange={(event) => setDrillDays(event.target.value)}
          />
        </label>
      </div>
      <Button
        variant="outline"
        disabled={busy || !config || !valid}
        title={capabilityNote('operations.backups')}
        onClick={() => void read()}
      >
        {busy ? 'Checking…' : 'Check backups'}
      </Button>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {evidence && (
        <div className="space-y-2" data-testid="backup-evidence">
          <p className="text-xs text-muted-foreground">
            Read {new Date(evidence.readAt).toLocaleTimeString(getIntlLocale())} · namespace{' '}
            {evidence.namespace ?? 'unknown'} · stale after {evidence.staleHours} hours
          </p>
          <ul className="space-y-1" aria-label="Backup evidence">
            {[...evidence.backups, ...evidence.schedules, evidence.drill].map((finding) => (
              <Finding key={`${finding.source}:${finding.subject}`} finding={finding} />
            ))}
          </ul>
          {evidence.unknown.length > 0 && (
            <ul className="text-xs" data-testid="backup-unknown">
              {evidence.unknown.map((item) => (
                <li key={item}>Unknown · {item}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  )
}
