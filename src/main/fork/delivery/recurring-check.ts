import { randomUUID } from 'node:crypto'
import type { BackupsRequest } from '../../../shared/fork-delivery/backup-contract'
import type { CertificatesRequest } from '../../../shared/fork-delivery/certificate-contract'
import type {
  VerificationRun,
  VerifyRequest
} from '../../../shared/fork-delivery/operations-contract'
import type { RecurringRunRequest } from '../../../shared/fork-delivery/recurring-contract'
import { readBackupEvidence, type BackupDeps } from './backup-evidence'
import { readCertificateEvidence, type CertificateDeps } from './certificate-evidence'
import { runJourneyCheck } from './journey-check'
import type { DiagnosisDeps } from './workload-diagnosis'

export type RecurringDeps = {
  journey: DiagnosisDeps
  certificates: CertificateDeps
  backups: BackupDeps
}
type Finding = { subject: string; status: 'verified' | 'mismatch' | 'unknown'; detail: string }

/** Passed only when something was checked and every finding verified; the first problem shown. */
function summarize(findings: Finding[], unknown: string[]): { passed: boolean; detail: string } {
  const count = (status: Finding['status']) =>
    findings.filter((finding) => finding.status === status).length
  const problem =
    findings.find((finding) => finding.status === 'mismatch') ??
    findings.find((finding) => finding.status === 'unknown')
  const unread = unknown.length
  const detail = [
    `${count('verified')} verified · ${count('mismatch')} mismatch · ${count('unknown') + unread} unknown`,
    problem ? `${problem.subject}: ${problem.detail}` : unread ? unknown[0] : null
  ]
    .filter(Boolean)
    .join(' · ')
  return {
    passed: findings.length > 0 && !problem && unread === 0,
    detail: findings.length === 0 && unread === 0 ? 'nothing to check' : detail
  }
}

/** Runs one admitted recurring check on the owner. Read-only: the union admits nothing else. */
export async function runRecurringCheck(
  { task, request }: RecurringRunRequest,
  deps: RecurringDeps,
  now = Date.now()
): Promise<VerificationRun> {
  const base = {
    id: randomUUID(),
    at: now,
    runbook: null,
    revision: null,
    runningDigests: [],
    task
  }
  if (request.check === 'journey') {
    const { check: _check, journey, ...config } = request
    const verify: VerifyRequest = { ...config, check: journey, kind: 'check', runbook: null }
    return { ...(await runJourneyCheck(verify, deps.journey, now)), task }
  }
  if (request.check === 'certificates') {
    const { check: _check, ...certificates } = request
    const input: CertificatesRequest = certificates
    const evidence = await readCertificateEvidence(input, deps.certificates, now)
    return {
      ...base,
      kind: 'certificates',
      target: input.endpoints.length ? input.endpoints.join(', ') : 'cert-manager Certificates',
      ...summarize([...evidence.endpoints, ...evidence.certificates], evidence.unknown)
    }
  }
  const { check: _check, ...backups } = request
  const input: BackupsRequest = backups
  const evidence = await readBackupEvidence(input, deps.backups, now)
  return {
    ...base,
    kind: 'backups',
    target: `Velero in ${input.veleroNamespace} · restore drill`,
    ...summarize([...evidence.backups, ...evidence.schedules, evidence.drill], evidence.unknown)
  }
}
