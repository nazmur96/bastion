import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { getIntlLocale } from '@/i18n/i18n'
import { capabilityNote } from '../../../../shared/fork-cloud/operation-capabilities'
import type { DeliveryConfig } from '../../../../shared/fork-delivery/delivery-contract'
import type {
  MonitoringCheck,
  MonitoringEvidence
} from '../../../../shared/fork-delivery/monitoring-contract'
import { ownerOperation } from './operations-owner-client'

function Status({ status }: { status: MonitoringCheck['status'] }): React.JSX.Element {
  return <Badge variant={status === 'verified' ? 'secondary' : 'outline'}>{status}</Badge>
}
function External({
  url,
  children
}: {
  url: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <a className="underline" href={url} target="_blank" rel="noreferrer noopener">
      {children}
    </a>
  )
}

/** Fork: Step 14.2 read-only signals from the project's own Prometheus, plus Grafana links. */
export function DeliveryMonitoringSection({
  config
}: {
  config: DeliveryConfig | null
}): React.JSX.Element {
  const [evidence, setEvidence] = useState<MonitoringEvidence | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const read = async (): Promise<void> => {
    if (!config) {
      return
    }
    setBusy(true)
    setError(null)
    setEvidence(null)
    try {
      const result = await ownerOperation(
        config.projectId,
        'operations.monitoring',
        config,
        async () => window.api.cloudTargets?.operations?.monitoring(config)
      )
      if (result?.ok) {
        setEvidence(result.evidence)
      } else {
        setError(result?.message ?? 'Monitoring is unavailable in this client.')
      }
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="workspace-card space-y-3" data-testid="delivery-monitoring">
      <div>
        <h2 className="text-sm font-medium">Monitoring</h2>
        <p className="text-xs text-muted-foreground">
          Reads the Prometheus (and optional Grafana) attached in .bastion/monitoring.json. Bastion
          never installs a monitoring stack or stores a token. Connector health is shown apart from
          the signals; a missing metric is unknown, not healthy.
        </p>
      </div>
      <Button
        variant="outline"
        disabled={busy || !config}
        title={capabilityNote('operations.monitoring')}
        onClick={() => void read()}
      >
        {busy ? 'Reading…' : 'Read monitoring'}
      </Button>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {evidence && !evidence.attached && (
        <p className="text-xs" data-testid="monitoring-not-attached">
          No monitoring attached. Add .bastion/monitoring.json with a Prometheus service or URL.
        </p>
      )}
      {evidence?.attached && (
        <div className="space-y-2" data-testid="monitoring-evidence">
          <p className="text-xs text-muted-foreground">
            Read {new Date(evidence.readAt).toLocaleTimeString(getIntlLocale())} · namespace{' '}
            {evidence.namespace ?? 'unknown'}
          </p>
          <ul className="space-y-1" aria-label="Monitoring connectors">
            {evidence.connectors.map((connector) => (
              <li key={connector.name} className="text-xs" data-connector={connector.name}>
                <span className="font-medium">{connector.name}</span> · {connector.via}
                <br />
                <Status status={connector.reachable.status} /> reachable ·{' '}
                {connector.reachable.detail} <Status status={connector.auth.status} /> auth ·{' '}
                {connector.auth.detail}
                {connector.freshness && (
                  <>
                    {' '}
                    <Status status={connector.freshness.status} /> freshness ·{' '}
                    {connector.freshness.detail}
                  </>
                )}
              </li>
            ))}
          </ul>
          <ul className="space-y-1" aria-label="Workload signals">
            {evidence.signals.map((signal) => (
              <li key={signal.id} className="font-mono text-xs break-all" data-signal={signal.id}>
                <Status status={signal.status} /> {signal.label} · {signal.detail}
                {signal.link && (
                  <>
                    {' '}
                    · <External url={signal.link}>query</External>
                  </>
                )}
              </li>
            ))}
          </ul>
          <ul className="space-y-1 text-xs" aria-label="Alerts">
            {evidence.alerts.map((alert) => (
              <li key={`${alert.name}:${alert.since ?? ''}`} data-alert={alert.name}>
                <Badge variant="outline">{alert.state}</Badge> {alert.name}
                {alert.severity ? ` · ${alert.severity}` : ''}
                {alert.since ? ` · since ${alert.since.slice(0, 16).replace('T', ' ')}` : ''}
                {alert.link && (
                  <>
                    {' '}
                    · <External url={alert.link}>open</External>
                  </>
                )}
              </li>
            ))}
            {evidence.namespace && evidence.signals.length > 0 && evidence.alerts.length === 0 && (
              <li>No firing or pending alerts for {evidence.namespace}.</li>
            )}
          </ul>
          {evidence.links.length > 0 && (
            <p className="text-xs">
              {evidence.links.map((link) => (
                <span key={link.url} className="mr-3">
                  <External url={link.url}>{link.label}</External>
                </span>
              ))}
            </p>
          )}
          {evidence.unknown.length > 0 && (
            <ul className="text-xs" data-testid="monitoring-unknown">
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
