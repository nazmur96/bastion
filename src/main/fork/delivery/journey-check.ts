import { createHash, randomUUID } from 'node:crypto'
import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  VerificationRun,
  VerifyRequest
} from '../../../shared/fork-delivery/operations-contract'
import { readWorkloadDiagnosis, type DiagnosisDeps } from './workload-diagnosis'

const MAX_RUNS = 200

/**
 * One GET through the cluster API service proxy, on the same pinned context as the evidence.
 * No port-forward and no write; any error is a failed run with its reason.
 */
export async function runJourneyCheck(
  request: VerifyRequest,
  deps: DiagnosisDeps,
  now = Date.now()
): Promise<VerificationRun> {
  const workload = await readWorkloadDiagnosis({ ...request, logs: false }, deps, now)
  const revisions = [...new Set(workload.containers.map((container) => container.revision))]
  const runningDigests = [
    ...new Set(workload.containers.flatMap((container) => container.digest ?? []))
  ]
  const { service, port, path, expect } = request.check
  const target = `${service}:${port}${path}`
  const record = (passed: boolean, detail: string): VerificationRun => ({
    id: randomUUID(),
    kind: request.kind,
    runbook: request.runbook,
    at: now,
    passed,
    detail,
    target: workload.namespace ? `${workload.namespace}/${target}` : target,
    revision: revisions.length === 1 ? revisions[0] : null,
    runningDigests
  })
  if (!workload.namespace) {
    return record(false, `Not run: ${workload.unknown[0] ?? 'no destination namespace'}`)
  }
  const result = await deps.kubectl([
    'get',
    '--raw',
    `/api/v1/namespaces/${workload.namespace}/services/${service}:${port}/proxy${path}`
  ])
  if (!result.ok) {
    return record(false, `Request failed (${result.code}): ${result.out.slice(0, 200)}`)
  }
  return result.out.includes(expect)
    ? record(true, `Response contains "${expect}"`)
    : record(false, `Response does not contain "${expect}"`)
}

/** Append-only per-project history: a failed run is never replaced by a later pass. */
export function verificationStore(directory: string) {
  const file = (projectId: string) =>
    join(directory, `${createHash('sha256').update(projectId).digest('hex')}.jsonl`)
  return {
    append: async (projectId: string, run: VerificationRun): Promise<void> => {
      await mkdir(directory, { recursive: true, mode: 0o700 })
      await appendFile(file(projectId), `${JSON.stringify(run)}\n`, { mode: 0o600 })
    },
    list: async (projectId: string, limit = MAX_RUNS): Promise<VerificationRun[]> => {
      let text = ''
      try {
        text = await readFile(file(projectId), 'utf8')
      } catch {
        return []
      }
      return text
        .split('\n')
        .filter(Boolean)
        .flatMap((line): VerificationRun[] => {
          try {
            return [JSON.parse(line)]
          } catch {
            return []
          }
        })
        .slice(-limit)
        .toReversed()
    }
  }
}
