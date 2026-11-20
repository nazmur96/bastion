import { app, ipcMain, type WebContents } from 'electron'
import { join } from 'node:path'
import { z } from 'zod'
import { readProjectWorkspaceContext } from '../project-workspaces/workspace-context'
import { isTrustedUIRenderer } from '../../ipc/ui'
import { admitChannelOperation } from '../../../shared/fork-cloud/operation-capabilities'
import {
  diagnoseSchema,
  runbookCreateSchema,
  verifySchema
} from '../../../shared/fork-delivery/operations-contract'
import type { CloudWorkspaceProvider } from '../cloud/cloud-workspace-provider'
import { deliverySources } from './delivery-sources'
import { runJourneyCheck, verificationStore } from './journey-check'
import { RunbookError, createRunbook, listRunbooks } from './runbook-files'
import { FlociFailure } from '../../../shared/fork-cloud/floci-contract'
import { readWorkloadDiagnosis } from './workload-diagnosis'
import { probeTls, readCertificateEvidence } from './certificate-evidence'
import { certificatesSchema } from '../../../shared/fork-delivery/certificate-contract'
import { readBackupEvidence } from './backup-evidence'
import { backupsSchema } from '../../../shared/fork-delivery/backup-contract'
import { deliveryConfigSchema } from '../../../shared/fork-delivery/delivery-contract'
import { readMonitoringEvidence } from './monitoring-evidence'
import { monitoringSources } from './monitoring-sources'

const MESSAGES: Record<string, string> = {
  invalid: 'Invalid operations request.',
  workspace: 'Operations require a project workspace.',
  exists: 'A runbook with that name already exists. Nothing was changed.',
  'unsafe-path': 'The runbooks directory is a symlink or not a directory. Nothing was changed.',
  owner:
    "Runbooks are created on this computer only. For a remote (SSH) project, add the file under runbooks/ in the editor and commit it; diagnosis and checks run on the project's owner.",
  failed: 'The operation failed.'
}
const projectSchema = z.object({ projectId: z.string().min(1).max(4096) }).strict()
const OPERATIONS = [
  'operationsDiagnose',
  'operationsVerify',
  'operationsRuns',
  'operationsCertificates',
  'operationsBackups',
  'operationsMonitoring',
  'runbookList',
  'runbookCreate'
] as const

/** Fork: Step 12 handlers. Local owners only; every cluster read uses one pinned context. */
export function registerOperationsHandlers(
  requireProvider: (sender: WebContents) => CloudWorkspaceProvider
): void {
  const store = () => verificationStore(join(app.getPath('userData'), 'bastion-verification'))
  for (const operation of OPERATIONS) {
    ipcMain.handle(`bastionCloud:${operation}`, async (event, raw: unknown) => {
      try {
        const context = readProjectWorkspaceContext()
        const assertCurrent = () => {
          if (
            !context?.workspace ||
            context.incognito ||
            readProjectWorkspaceContext() !== context ||
            event.sender.isDestroyed() ||
            !isTrustedUIRenderer(event.sender) ||
            event.senderFrame !== event.sender.mainFrame
          ) {
            throw new Error('workspace')
          }
        }
        assertCurrent()
        const provider = requireProvider(event.sender)
        const parse = <T>(schema: z.ZodType<T>): T => {
          const parsed = schema.safeParse(raw)
          if (!parsed.success) {
            throw new Error('invalid')
          }
          return parsed.data
        }
        if (operation === 'operationsDiagnose') {
          const request = parse(diagnoseSchema)
          admitChannelOperation(
            'bastionCloud:operationsDiagnose',
            request.logs ? 'operations.logs' : 'operations.diagnose'
          )
          const { owner } = await provider.owner(request.projectId)
          const diagnosis = await readWorkloadDiagnosis(
            request,
            deliverySources(owner.root, request.repository)
          )
          assertCurrent()
          return { ok: true, diagnosis }
        }
        if (operation === 'operationsVerify') {
          const request = parse(verifySchema)
          admitChannelOperation('bastionCloud:operationsVerify', 'operations.verify')
          const { owner } = await provider.owner(request.projectId)
          const run = await runJourneyCheck(
            request,
            deliverySources(owner.root, request.repository)
          )
          // Recorded even if the workspace changed meanwhile: a run that happened is never lost.
          await store().append(request.projectId, run)
          assertCurrent()
          return { ok: true, run }
        }
        if (operation === 'operationsCertificates') {
          const request = parse(certificatesSchema)
          admitChannelOperation('bastionCloud:operationsCertificates', 'operations.certificates')
          const { owner } = await provider.owner(request.projectId)
          const sources = deliverySources(owner.root, request.repository)
          const evidence = await readCertificateEvidence(request, {
            kubectl: sources.kubectl,
            probe: (host, port) => probeTls(host, port)
          })
          assertCurrent()
          return { ok: true, evidence }
        }
        if (operation === 'operationsBackups') {
          const request = parse(backupsSchema)
          admitChannelOperation('bastionCloud:operationsBackups', 'operations.backups')
          const { owner } = await provider.owner(request.projectId)
          const evidence = await readBackupEvidence(request, {
            kubectl: deliverySources(owner.root, request.repository).kubectl,
            runs: () => store().list(request.projectId)
          })
          assertCurrent()
          return { ok: true, evidence }
        }
        if (operation === 'operationsMonitoring') {
          const request = parse(deliveryConfigSchema)
          admitChannelOperation('bastionCloud:operationsMonitoring', 'operations.monitoring')
          const { owner } = await provider.owner(request.projectId)
          const evidence = await readMonitoringEvidence(
            request,
            monitoringSources(owner.root, deliverySources(owner.root, request.repository).kubectl)
          )
          assertCurrent()
          return { ok: true, evidence }
        }
        if (operation === 'operationsRuns') {
          const request = parse(projectSchema)
          admitChannelOperation('bastionCloud:operationsRuns', 'operations.runs')
          await provider.owner(request.projectId)
          return { ok: true, runs: await store().list(request.projectId) }
        }
        if (operation === 'runbookList') {
          const request = parse(projectSchema)
          admitChannelOperation('bastionCloud:runbookList', 'runbooks.read')
          const { owner } = await provider.owner(request.projectId)
          return { ok: true, runbooks: await listRunbooks(owner.root) }
        }
        const request = parse(runbookCreateSchema)
        admitChannelOperation('bastionCloud:runbookCreate', 'runbooks.create')
        const { owner, assertOwner } = await provider.owner(request.projectId)
        assertOwner()
        assertCurrent()
        return { ok: true, path: await createRunbook(owner.root, request.name, request.content) }
      } catch (error) {
        const code =
          error instanceof RunbookError
            ? error.code
            : error instanceof FlociFailure
              ? 'owner'
              : error instanceof Error && error.message in MESSAGES
                ? error.message
                : 'failed'
        return { ok: false, code, message: MESSAGES[code] }
      }
    })
  }
}
