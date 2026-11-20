import { checkServerIdentity, connect, type PeerCertificate } from 'node:tls'
import { z } from 'zod'
import type {
  CertificateEvidence,
  CertificateFinding,
  CertificatesRequest
} from '../../../shared/fork-delivery/certificate-contract'
import type { DeliveryDeps } from './delivery-chain'

export type TlsObservation =
  | {
      ok: true
      notAfter: string
      issuer: string | null
      /** Chain verified against the owner's trust store. */
      trusted: boolean
      trustError: string | null
      hostnameMatches: boolean
    }
  | { ok: false; reason: string }
export type CertificateDeps = Pick<DeliveryDeps, 'kubectl'> & {
  probe: (host: string, port: number) => Promise<TlsObservation>
}

const DAY = 24 * 60 * 60 * 1000
const applicationSchema = z.object({
  spec: z.object({ destination: z.object({ namespace: z.string().optional() }) })
})
const certificatesSchema = z.object({
  items: z.array(
    z.object({
      metadata: z.object({ name: z.string(), namespace: z.string().optional() }),
      spec: z.object({ issuerRef: z.object({ name: z.string().optional() }).optional() }),
      status: z
        .object({
          notAfter: z.string().optional(),
          conditions: z
            .array(
              z.object({ type: z.string(), status: z.string(), reason: z.string().optional() })
            )
            .optional()
        })
        .optional()
    })
  )
})

function parse<T>(schema: z.ZodType<T>, text: string): T | null {
  try {
    const result = schema.safeParse(JSON.parse(text))
    return result.success ? result.data : null
  } catch {
    return null
  }
}

/** Expired, expiring within the warning window, or still comfortably valid. */
function expiry(
  notAfter: string,
  warnDays: number,
  now: number
): { status: CertificateFinding['status']; detail: string; daysLeft: number | null } {
  const end = Date.parse(notAfter)
  if (Number.isNaN(end)) {
    return { status: 'unknown', detail: 'expiry date unreadable', daysLeft: null }
  }
  const daysLeft = Math.floor((end - now) / DAY)
  if (end <= now) {
    return { status: 'mismatch', detail: 'expired', daysLeft }
  }
  return daysLeft < warnDays
    ? { status: 'mismatch', detail: `expires in ${daysLeft} days`, daysLeft }
    : { status: 'verified', detail: `valid for ${daysLeft} more days`, daysLeft }
}

function endpointFinding(
  subject: string,
  observed: TlsObservation,
  warnDays: number,
  now: number
): CertificateFinding {
  const source = `TLS ${subject}`
  if (!observed.ok) {
    return {
      subject,
      status: 'unknown',
      detail: observed.reason,
      notAfter: null,
      daysLeft: null,
      issuer: null,
      source
    }
  }
  const dated = expiry(observed.notAfter, warnDays, now)
  // Expiry first: an expired certificate is reported as expired, whatever else is wrong.
  const problem =
    dated.detail === 'expired'
      ? null
      : !observed.hostnameMatches
        ? 'hostname does not match the certificate'
        : !observed.trusted
          ? `chain not trusted (${observed.trustError ?? 'unknown reason'})`
          : null
  return {
    subject,
    status: problem ? 'mismatch' : dated.status,
    detail: problem ?? dated.detail,
    notAfter: observed.notAfter,
    daysLeft: dated.daysLeft,
    issuer: observed.issuer,
    source
  }
}

/** Read-only certificate evidence for the listed endpoints and the application's namespace. */
export async function readCertificateEvidence(
  request: CertificatesRequest,
  deps: CertificateDeps,
  now = Date.now()
): Promise<CertificateEvidence> {
  const unknown: string[] = []
  const endpoints = await Promise.all(
    request.endpoints.map(async (value) => {
      const [host, port] = value.includes(':') ? value.split(':') : [value, '443']
      const subject = `${host}:${port}`
      return endpointFinding(subject, await deps.probe(host, Number(port)), request.warnDays, now)
    })
  )
  const certificates: CertificateFinding[] = []
  const app = await deps.kubectl([
    '-n',
    request.applicationNamespace,
    'get',
    'applications.argoproj.io',
    request.application,
    '-o',
    'json'
  ])
  const namespace = app.ok
    ? (parse(applicationSchema, app.out)?.spec.destination.namespace ?? null)
    : null
  if (!namespace) {
    unknown.push(`Argo CD Application: ${app.ok ? 'no destination namespace' : app.code}`)
  } else {
    const listed = await deps.kubectl([
      '-n',
      namespace,
      'get',
      'certificates.cert-manager.io',
      '-o',
      'json'
    ])
    const items = listed.ok ? parse(certificatesSchema, listed.out)?.items : null
    if (!items) {
      // A cluster without cert-manager answers "the server doesn't have a resource type".
      unknown.push(
        `cert-manager Certificates in ${namespace}: ${
          listed.ok
            ? 'unexpected shape'
            : /doesn't have a resource type/.test(listed.out)
              ? 'cert-manager not installed'
              : listed.code
        }`
      )
    }
    for (const item of items ?? []) {
      const subject = `${item.metadata.namespace ?? namespace}/${item.metadata.name}`
      const ready = item.status?.conditions?.find((condition) => condition.type === 'Ready')
      const issuer = item.spec.issuerRef?.name ?? null
      const source = `cert-manager ${subject}`
      if (!item.status?.notAfter) {
        certificates.push({
          subject,
          status: 'unknown',
          detail:
            ready?.status === 'False'
              ? `not issued (${ready.reason ?? 'not ready'})`
              : 'not issued yet',
          notAfter: null,
          daysLeft: null,
          issuer,
          source
        })
        continue
      }
      const dated = expiry(item.status.notAfter, request.warnDays, now)
      const notReady = ready && ready.status !== 'True'
      certificates.push({
        subject,
        status: notReady && dated.status === 'verified' ? 'mismatch' : dated.status,
        detail:
          notReady && dated.status === 'verified'
            ? `not ready (${ready.reason ?? 'unknown'})`
            : dated.detail,
        notAfter: item.status.notAfter,
        daysLeft: dated.daysLeft,
        issuer,
        source
      })
    }
  }
  return { warnDays: request.warnDays, endpoints, certificates, unknown, readAt: now }
}

function issuerName(certificate: PeerCertificate): string | null {
  const value = certificate.issuer?.O ?? certificate.issuer?.CN
  return typeof value === 'string' ? value.slice(0, 200) : null
}

/** One TLS handshake with SNI; nothing is sent after it. Trust uses the owner's store. */
export function probeTls(host: string, port: number, timeoutMs = 10_000): Promise<TlsObservation> {
  return new Promise((resolve) => {
    const socket = connect({ host, port, servername: host, rejectUnauthorized: false })
    const done = (value: TlsObservation) => {
      socket.destroy()
      resolve(value)
    }
    socket.setTimeout(timeoutMs, () => done({ ok: false, reason: 'timed out' }))
    socket.once('error', (error: NodeJS.ErrnoException) =>
      done({
        ok: false,
        reason: error.code ? `connection failed (${error.code})` : 'connection failed'
      })
    )
    socket.once('secureConnect', () => {
      const certificate = socket.getPeerCertificate()
      if (!certificate?.valid_to) {
        done({ ok: false, reason: 'no certificate presented' })
        return
      }
      const authorizationError = socket.authorizationError
      done({
        ok: true,
        notAfter: new Date(certificate.valid_to).toISOString(),
        issuer: issuerName(certificate),
        trusted: socket.authorized,
        trustError: authorizationError ? String(authorizationError).slice(0, 80) : null,
        hostnameMatches: checkServerIdentity(host, certificate) === undefined
      })
    })
  })
}
