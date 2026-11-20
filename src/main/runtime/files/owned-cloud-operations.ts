import { realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import {
  CloudOperationCall,
  type CloudOperationCallParams
} from '../../../shared/fork-cloud/cloud-operation-contract'
import { OPERATION_CAPABILITIES } from '../../../shared/fork-cloud/operation-capabilities'
import { deliveryConfigSchema } from '../../../shared/fork-delivery/delivery-contract'
import { diagnoseSchema, verifySchema } from '../../../shared/fork-delivery/operations-contract'
import { getProfileUserDataPath } from '../../orca-profiles/profile-storage-paths'
import { readDeliveryChain } from '../../fork/delivery/delivery-chain'
import { deliverySources } from '../../fork/delivery/delivery-sources'
import { runJourneyCheck, verificationStore } from '../../fork/delivery/journey-check'
import { readWorkloadDiagnosis } from '../../fork/delivery/workload-diagnosis'
import { probeTls, readCertificateEvidence } from '../../fork/delivery/certificate-evidence'
import { certificatesSchema } from '../../../shared/fork-delivery/certificate-contract'
import { readBackupEvidence } from '../../fork/delivery/backup-evidence'
import { backupsSchema } from '../../../shared/fork-delivery/backup-contract'
import { readMonitoringEvidence } from '../../fork/delivery/monitoring-evidence'
import { monitoringSources } from '../../fork/delivery/monitoring-sources'
import { runRecurringCheck } from '../../fork/delivery/recurring-check'
import { recurringRunSchema } from '../../../shared/fork-delivery/recurring-contract'
import { assertRuntimeFileMutationExpectation } from './file-mutation-expectation'
import { requireLocalRuntimeFileRoute } from './file-target'
import { resolveRuntimeAuthorizedPath } from './chat-scratch-file-root'
import type { RuntimeFileCommandHost } from './file-command-host'
import type { ExecutionHostId } from '../../../shared/execution-host'

type OwnerHost = Pick<RuntimeFileCommandHost, 'getRuntimeId' | 'requireStore'> & {
  resolveRuntimeFileTarget(
    selector: string
  ): Promise<{ worktree: { id: string; path: string }; executionHostId: ExecutionHostId }>
}
const projectOnly = z.object({ projectId: z.string().min(1).max(4096) }).strict()

/**
 * Fork: cloud operations performed by the runtime that owns the project, with that host's own
 * git, gh, kubectl and kubeconfig. The root is resolved here exactly as owned change runs do.
 */
export class RuntimeOwnedCloudOperations {
  constructor(private readonly host: OwnerHost) {}

  private async root(params: CloudOperationCallParams) {
    if (params.expectedRuntimeId !== this.host.getRuntimeId()) {
      throw new Error('The project owner restarted. Refresh and try again.')
    }
    const target = await this.host.resolveRuntimeFileTarget(params.worktree)
    requireLocalRuntimeFileRoute(target)
    assertRuntimeFileMutationExpectation(
      target.executionHostId,
      params.expectedExecutionHostId,
      params.expectedSshTargetId,
      params.expectedSshConnectionGeneration
    )
    if (target.worktree.path !== params.expectedRoot) {
      throw new Error('Project root changed; refresh and try again.')
    }
    const root = await realpath(
      await resolveRuntimeAuthorizedPath(target.worktree.path, this.host.requireStore())
    )
    return { worktreeId: target.worktree.id, root }
  }

  async run(raw: unknown): Promise<unknown> {
    const params = CloudOperationCall.parse(raw)
    // Every admitted operation must run on the owner; the registry is the single source.
    if (OPERATION_CAPABILITIES[params.operation].runsOn !== 'owner') {
      throw new Error('Operation is not admitted on the project owner.')
    }
    const { worktreeId, root } = await this.root(params)
    const store = verificationStore(join(getProfileUserDataPath(), 'bastion-verification'))
    switch (params.operation) {
      case 'delivery.evidence': {
        const request = deliveryConfigSchema.parse(params.request)
        return {
          chain: await readDeliveryChain(request, deliverySources(root, request.repository))
        }
      }
      case 'operations.diagnose':
      case 'operations.logs': {
        const request = diagnoseSchema.parse(params.request)
        if (request.logs !== (params.operation === 'operations.logs')) {
          throw new Error('Log reads must be requested as operations.logs.')
        }
        return {
          diagnosis: await readWorkloadDiagnosis(request, deliverySources(root, request.repository))
        }
      }
      case 'operations.verify': {
        const request = verifySchema.parse(params.request)
        const run = await runJourneyCheck(request, deliverySources(root, request.repository))
        // Kept on the owner, keyed by the owner's own project identity.
        await store.append(worktreeId, run)
        return { run }
      }
      case 'operations.certificates': {
        const request = certificatesSchema.parse(params.request)
        const sources = deliverySources(root, request.repository)
        return {
          evidence: await readCertificateEvidence(request, {
            kubectl: sources.kubectl,
            probe: (host, port) => probeTls(host, port)
          })
        }
      }
      case 'operations.backups': {
        const request = backupsSchema.parse(params.request)
        return {
          evidence: await readBackupEvidence(request, {
            kubectl: deliverySources(root, request.repository).kubectl,
            runs: () => store.list(worktreeId, Number.POSITIVE_INFINITY)
          })
        }
      }
      case 'operations.monitoring': {
        const request = deliveryConfigSchema.parse(params.request)
        return {
          evidence: await readMonitoringEvidence(
            request,
            monitoringSources(root, deliverySources(root, request.repository).kubectl)
          )
        }
      }
      case 'operations.recurring': {
        const request = recurringRunSchema.parse(params.request)
        const sources = deliverySources(root, request.request.repository)
        const run = await runRecurringCheck(request, {
          journey: sources,
          certificates: { kubectl: sources.kubectl, probe: (host, port) => probeTls(host, port) },
          backups: {
            kubectl: sources.kubectl,
            runs: () => store.list(worktreeId, Number.POSITIVE_INFINITY)
          }
        })
        await store.append(worktreeId, run)
        return { run }
      }
      case 'operations.runs': {
        projectOnly.parse(params.request)
        return { runs: await store.list(worktreeId) }
      }
    }
  }
}
