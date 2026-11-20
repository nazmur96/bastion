import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { getIntlLocale } from '@/i18n/i18n'
import { capabilityNote } from '../../../../shared/fork-cloud/operation-capabilities'
import type { DeliveryConfig } from '../../../../shared/fork-delivery/delivery-contract'
import type {
  CertificateEvidence,
  CertificateFinding
} from '../../../../shared/fork-delivery/certificate-contract'
import { ownerOperation } from './operations-owner-client'

const input = 'rounded-md border border-input bg-background px-2 py-1 font-mono text-sm'

function Finding({ finding }: { finding: CertificateFinding }): React.JSX.Element {
  return (
    <li className="font-mono text-xs break-all" data-certificate={finding.subject}>
      <Badge variant={finding.status === 'verified' ? 'secondary' : 'outline'}>
        {finding.status}
      </Badge>{' '}
      {finding.subject} · {finding.detail}
      {finding.notAfter ? ` · until ${finding.notAfter.slice(0, 10)}` : ''}
      {finding.issuer ? ` · ${finding.issuer}` : ''}
    </li>
  )
}

/** Fork: Step 14.3 read-only certificate evidence for the app's endpoints and cert-manager. */
export function DeliveryCertificatesSection({
  config
}: {
  config: DeliveryConfig | null
}): React.JSX.Element {
  const [endpoints, setEndpoints] = useState('')
  const [warnDays, setWarnDays] = useState('21')
  const [evidence, setEvidence] = useState<CertificateEvidence | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const list = endpoints
    .split(/[\s,]+/)
    .map((value) => value.trim())
    .filter(Boolean)
  const days = Number(warnDays)
  const valid = Number.isInteger(days) && days >= 1 && days <= 90 && list.length <= 10
  const read = async (): Promise<void> => {
    if (!config || !valid) {
      return
    }
    setBusy(true)
    setError(null)
    setEvidence(null)
    try {
      const request = { ...config, endpoints: list, warnDays: days }
      const result = await ownerOperation(
        config.projectId,
        'operations.certificates',
        request,
        async () => window.api.cloudTargets?.operations?.certificates(request)
      )
      if (result?.ok) {
        setEvidence(result.evidence)
      } else {
        setError(result?.message ?? 'Certificate checks are unavailable in this client.')
      }
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="workspace-card space-y-3" data-testid="delivery-certificates">
      <div>
        <h2 className="text-sm font-medium">Certificates</h2>
        <p className="text-xs text-muted-foreground">
          One TLS handshake per endpoint from the project&apos;s owner, plus cert-manager
          Certificates in the application&apos;s namespace. Read-only. Expired, untrusted,
          mismatched or expiring within the warning window is a mismatch; unreachable is unknown.
        </p>
      </div>
      <div className="grid gap-2 sm:grid-cols-4">
        <label className="flex flex-col gap-1 text-xs sm:col-span-3">
          Endpoints (host or host:port, up to 10)
          <input
            className={input}
            value={endpoints}
            placeholder="app.example.com, api.example.com:8443"
            onChange={(event) => setEndpoints(event.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          Warn within (days)
          <input
            className={input}
            value={warnDays}
            onChange={(event) => setWarnDays(event.target.value)}
          />
        </label>
      </div>
      <Button
        variant="outline"
        disabled={busy || !config || !valid}
        title={capabilityNote('operations.certificates')}
        onClick={() => void read()}
      >
        {busy ? 'Checking…' : 'Check certificates'}
      </Button>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {evidence && (
        <div className="space-y-2" data-testid="certificate-evidence">
          <p className="text-xs text-muted-foreground">
            Read {new Date(evidence.readAt).toLocaleTimeString(getIntlLocale())} · warning window{' '}
            {evidence.warnDays} days
          </p>
          <ul className="space-y-1" aria-label="Endpoint certificates">
            {evidence.endpoints.map((finding) => (
              <Finding key={finding.subject} finding={finding} />
            ))}
          </ul>
          <ul className="space-y-1" aria-label="cert-manager certificates">
            {evidence.certificates.map((finding) => (
              <Finding key={finding.subject} finding={finding} />
            ))}
          </ul>
          {evidence.unknown.length > 0 && (
            <ul className="text-xs" data-testid="certificate-unknown">
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
