import { describe, expect, it } from 'vitest'
import type { CertificatesRequest } from '../../../shared/fork-delivery/certificate-contract'
import {
  readCertificateEvidence,
  type CertificateDeps,
  type TlsObservation
} from './certificate-evidence'

const NOW = Date.parse('2026-11-20T00:00:00Z')
const inDays = (days: number) => new Date(NOW + days * 24 * 60 * 60 * 1000).toISOString()
const request: CertificatesRequest = {
  projectId: 'p',
  repository: 'example/app',
  workflow: 'build.yml',
  configPath: 'deploy/kustomization.yaml',
  imageName: 'app',
  application: 'app',
  applicationNamespace: 'argocd',
  revision: null,
  endpoints: [],
  warnDays: 21
}
const good: TlsObservation = {
  ok: true,
  notAfter: inDays(60),
  issuer: 'Example CA',
  trusted: true,
  trustError: null,
  hostnameMatches: true
}
function deps(
  observations: Record<string, TlsObservation>,
  cluster: { app?: unknown; certificates?: unknown; certificatesError?: string } = {}
): CertificateDeps {
  return {
    probe: async (host, port) =>
      observations[`${host}:${port}`] ?? { ok: false, reason: 'timed out' },
    kubectl: async (args) => {
      if (args.includes('applications.argoproj.io')) {
        return cluster.app
          ? { ok: true, code: 'ok', out: JSON.stringify(cluster.app) }
          : { ok: false, code: 'no-context', out: '' }
      }
      return cluster.certificatesError
        ? { ok: false, code: 'failed', out: cluster.certificatesError }
        : { ok: true, code: 'ok', out: JSON.stringify(cluster.certificates ?? { items: [] }) }
    }
  }
}

describe('certificate evidence', () => {
  it('classifies endpoints: valid, expiring, expired, wrong host, untrusted, unreachable', async () => {
    const evidence = await readCertificateEvidence(
      {
        ...request,
        endpoints: [
          'ok.example',
          'soon.example',
          'old.example',
          'host.example',
          'self.example:8443',
          'gone.example'
        ]
      },
      deps({
        'ok.example:443': good,
        'soon.example:443': { ...good, notAfter: inDays(5) },
        // Expired wins over every other problem.
        'old.example:443': {
          ...good,
          notAfter: inDays(-1),
          trusted: false,
          hostnameMatches: false
        },
        // A hostname mismatch also fails trust in Node; the precise reason is reported.
        'host.example:443': { ...good, trusted: false, hostnameMatches: false },
        'self.example:8443': { ...good, trusted: false, trustError: 'DEPTH_ZERO_SELF_SIGNED_CERT' }
      }),
      NOW
    )
    expect(
      evidence.endpoints.map((finding) => [finding.subject, finding.status, finding.detail])
    ).toEqual([
      ['ok.example:443', 'verified', 'valid for 60 more days'],
      ['soon.example:443', 'mismatch', 'expires in 5 days'],
      ['old.example:443', 'mismatch', 'expired'],
      ['host.example:443', 'mismatch', 'hostname does not match the certificate'],
      ['self.example:8443', 'mismatch', 'chain not trusted (DEPTH_ZERO_SELF_SIGNED_CERT)'],
      ['gone.example:443', 'unknown', 'timed out']
    ])
  })
  it('reads cert-manager Certificates in the application namespace', async () => {
    const evidence = await readCertificateEvidence(
      request,
      deps(
        {},
        {
          app: { spec: { destination: { namespace: 'shop' } } },
          certificates: {
            items: [
              {
                metadata: { name: 'web', namespace: 'shop' },
                spec: { issuerRef: { name: 'letsencrypt' } },
                status: { notAfter: inDays(80), conditions: [{ type: 'Ready', status: 'True' }] }
              },
              {
                metadata: { name: 'api', namespace: 'shop' },
                spec: {},
                status: {
                  notAfter: inDays(70),
                  conditions: [{ type: 'Ready', status: 'False', reason: 'Renewing' }]
                }
              },
              {
                metadata: { name: 'new', namespace: 'shop' },
                spec: {},
                status: { conditions: [{ type: 'Ready', status: 'False', reason: 'Pending' }] }
              }
            ]
          }
        }
      ),
      NOW
    )
    expect(
      evidence.certificates.map((finding) => [finding.subject, finding.status, finding.detail])
    ).toEqual([
      ['shop/web', 'verified', 'valid for 80 more days'],
      ['shop/api', 'mismatch', 'not ready (Renewing)'],
      ['shop/new', 'unknown', 'not issued (Pending)']
    ])
    expect(evidence.unknown).toEqual([])
  })
  it('keeps an unreadable cluster or a cluster without cert-manager unknown, never empty', async () => {
    expect((await readCertificateEvidence(request, deps({}), NOW)).unknown).toEqual([
      'Argo CD Application: no-context'
    ])
    const without = await readCertificateEvidence(
      request,
      deps(
        {},
        {
          app: { spec: { destination: { namespace: 'shop' } } },
          certificatesError: 'error: the server doesn\'t have a resource type "certificates"'
        }
      ),
      NOW
    )
    expect(without.unknown).toEqual([
      'cert-manager Certificates in shop: cert-manager not installed'
    ])
  })
})
