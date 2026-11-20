import { Badge } from '@/components/ui/badge'
import { getIntlLocale } from '@/i18n/i18n'
import type { RealAwsBackups } from '../../../../shared/fork-cloud/real-aws-contract'

/** Fork: Step 14.4 RDS backup evidence, read through the anchored identity. */
export function RealAwsBackupsView({
  backups
}: {
  backups: RealAwsBackups | undefined
}): React.JSX.Element {
  return (
    <div className="space-y-1 text-xs" aria-label="Real AWS backups">
      <h3 className="text-sm font-medium">Database backups</h3>
      {!backups ? (
        <p>RDS backups: not checked · a free read. Use Read backups after verifying.</p>
      ) : backups.status !== 'ok' ? (
        <p>RDS backups: unknown · {backups.status}</p>
      ) : (
        <>
          <p>
            {backups.databases.length} database(s) · observed{' '}
            {new Date(backups.at).toLocaleString(getIntlLocale())}
            {backups.truncated ? ' · incomplete' : ''}
          </p>
          <ul className="space-y-1" data-testid="rds-backups">
            {backups.databases.map((database) => (
              <li key={database.id} className="font-mono break-all" data-database={database.id}>
                <Badge variant={database.status === 'verified' ? 'secondary' : 'outline'}>
                  {database.status}
                </Badge>{' '}
                {database.id} ({database.engine}) · {database.detail}
                {database.latestSnapshot
                  ? ` · last snapshot ${database.latestSnapshot.slice(0, 10)}`
                  : ' · no manual or automated snapshot listed'}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
