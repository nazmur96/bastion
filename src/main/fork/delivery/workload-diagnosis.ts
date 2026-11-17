import { z } from 'zod'
import type {
  ContainerState,
  DiagnoseRequest,
  LogExcerpt,
  RolloutState,
  WorkloadDiagnosis,
  WorkloadEvent
} from '../../../shared/fork-delivery/operations-contract'
import { logExcerpt, LOG_LIMITS } from '../../../shared/fork-delivery/log-excerpt'
import type { DeliveryDeps } from './delivery-chain'

export type DiagnosisDeps = Pick<DeliveryDeps, 'kubectl' | 'imageLabels'>

const DIGEST = /^sha256:[0-9a-f]{64}$/
const MAX_LOG_CONTAINERS = 3
const MAX_EVENTS = 20
const applicationSchema = z.object({
  spec: z.object({ destination: z.object({ namespace: z.string().optional() }) })
})
const deploymentsSchema = z.object({
  items: z.array(
    z.object({
      metadata: z.object({ name: z.string(), generation: z.number().optional() }),
      spec: z.object({ replicas: z.number().optional() }),
      status: z
        .object({
          observedGeneration: z.number().optional(),
          replicas: z.number().optional(),
          updatedReplicas: z.number().optional(),
          readyReplicas: z.number().optional(),
          availableReplicas: z.number().optional(),
          conditions: z
            .array(
              z.object({
                type: z.string(),
                status: z.string(),
                reason: z.string().optional(),
                message: z.string().optional()
              })
            )
            .optional()
        })
        .optional()
    })
  )
})
const stateSchema = z
  .object({
    running: z.object({}).passthrough().optional(),
    waiting: z.object({ reason: z.string().optional() }).optional(),
    terminated: z.object({ exitCode: z.number(), reason: z.string().optional() }).optional()
  })
  .optional()
const podsSchema = z.object({
  items: z.array(
    z.object({
      metadata: z.object({ name: z.string() }),
      status: z
        .object({
          containerStatuses: z
            .array(
              z.object({
                name: z.string(),
                ready: z.boolean(),
                restartCount: z.number(),
                imageID: z.string(),
                state: stateSchema,
                lastState: stateSchema
              })
            )
            .optional()
        })
        .optional()
    })
  )
})
const eventsSchema = z.object({
  items: z.array(
    z.object({
      reason: z.string().optional(),
      message: z.string().optional(),
      count: z.number().optional(),
      lastTimestamp: z.string().nullish(),
      eventTime: z.string().nullish(),
      involvedObject: z.object({ kind: z.string().optional(), name: z.string().optional() })
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
function stateLabel(state: z.infer<typeof stateSchema>): string {
  if (state?.waiting) {
    return `waiting ${state.waiting.reason ?? ''}`.trim()
  }
  if (state?.terminated) {
    return `terminated ${state.terminated.reason ?? `exit ${state.terminated.exitCode}`}`
  }
  return state?.running ? 'running' : 'unknown'
}
function rollout(item: z.infer<typeof deploymentsSchema>['items'][number]): RolloutState {
  const desired = item.spec.replicas ?? 1
  const status = item.status ?? {}
  const conditions = status.conditions ?? []
  const progressing = conditions.find((condition) => condition.type === 'Progressing')
  // Old pods still count as available during a rollout; complete means none are left.
  const complete =
    status.observedGeneration === item.metadata.generation &&
    (status.updatedReplicas ?? 0) === desired &&
    (status.replicas ?? 0) === desired &&
    (status.availableReplicas ?? 0) === desired
  return {
    name: item.metadata.name,
    desired,
    total: status.replicas ?? 0,
    updated: status.updatedReplicas ?? 0,
    ready: status.readyReplicas ?? 0,
    available: status.availableReplicas ?? 0,
    status:
      progressing?.reason === 'ProgressDeadlineExceeded'
        ? 'failed'
        : complete
          ? 'complete'
          : 'progressing',
    conditions: conditions
      .filter((condition) => condition.status !== 'True' || condition.type === 'Progressing')
      .map((condition) => `${condition.type}: ${condition.reason ?? condition.status}`)
  }
}

/** Read-only diagnosis of the Application's destination namespace. */
export async function readWorkloadDiagnosis(
  request: DiagnoseRequest,
  deps: DiagnosisDeps,
  now = Date.now()
): Promise<WorkloadDiagnosis> {
  const unknown: string[] = []
  const diagnosis: WorkloadDiagnosis = {
    namespace: null,
    rollouts: [],
    containers: [],
    events: [],
    logs: [],
    unknown,
    readAt: now
  }
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
    return diagnosis
  }
  diagnosis.namespace = namespace
  const read = async <T>(schema: z.ZodType<T>, label: string, args: string[]) => {
    const result = await deps.kubectl(['-n', namespace, ...args])
    const parsed = result.ok ? parse(schema, result.out) : null
    if (!parsed) {
      unknown.push(`${label}: ${result.ok ? 'unexpected shape' : result.code}`)
    }
    return parsed
  }
  const [deployments, pods, events] = await Promise.all([
    read(deploymentsSchema, 'Deployments', ['get', 'deployments', '-o', 'json']),
    read(podsSchema, 'Pods', ['get', 'pods', '-o', 'json']),
    read(eventsSchema, 'Warning events', [
      'get',
      'events',
      '--field-selector',
      'type=Warning',
      '-o',
      'json'
    ])
  ])
  diagnosis.rollouts = deployments?.items.map(rollout) ?? []
  diagnosis.events = (events?.items ?? [])
    .map((event): WorkloadEvent => ({
      reason: event.reason ?? 'Unknown',
      object: `${event.involvedObject.kind ?? ''}/${event.involvedObject.name ?? ''}`,
      message: logExcerpt((event.message ?? '').slice(0, 500)).text,
      count: event.count ?? 1,
      last: event.lastTimestamp ?? event.eventTime ?? ''
    }))
    .toSorted((a, b) => b.last.localeCompare(a.last))
    .slice(0, MAX_EVENTS)

  const revisions = new Map<string, Promise<{ revision: string | null; source: string }>>()
  const revisionOf = (imageID: string) => {
    const [repository, digest] = imageID.split('@')
    if (!repository || !digest || !DIGEST.test(digest)) {
      return Promise.resolve({ revision: null, source: 'no image digest reported' })
    }
    const lookup =
      revisions.get(imageID) ??
      deps.imageLabels(repository, digest).then((result) => {
        const label = result.labels?.['org.opencontainers.image.revision'] ?? null
        return label
          ? { revision: label, source: `${repository} revision label` }
          : { revision: null, source: result.reason ?? 'no revision label' }
      })
    revisions.set(imageID, lookup)
    return lookup
  }
  for (const pod of pods?.items ?? []) {
    for (const status of pod.status?.containerStatuses ?? []) {
      const digest = status.imageID.split('@').at(-1) ?? ''
      const linked = await revisionOf(status.imageID)
      const last = status.lastState?.terminated
      diagnosis.containers.push({
        pod: pod.metadata.name,
        container: status.name,
        ready: status.ready,
        restarts: status.restartCount,
        state: stateLabel(status.state),
        lastExit: last ? { code: last.exitCode, reason: last.reason ?? 'Unknown' } : null,
        digest: DIGEST.test(digest) ? digest : null,
        revision: linked.revision,
        revisionSource: linked.source
      } satisfies ContainerState)
    }
  }
  if (request.logs) {
    const failing = diagnosis.containers
      // A ready container that restarted earlier (for example after a node reboot) has recovered.
      .filter((container) => !container.ready)
      .slice(0, MAX_LOG_CONTAINERS)
    for (const container of failing) {
      for (const previous of container.restarts > 0 ? [false, true] : [false]) {
        const result = await deps.kubectl([
          '-n',
          namespace,
          'logs',
          container.pod,
          '-c',
          container.container,
          `--tail=${LOG_LIMITS.lines}`,
          `--limit-bytes=${LOG_LIMITS.bytes}`,
          ...(previous ? ['--previous'] : [])
        ])
        if (!result.ok) {
          unknown.push(
            `${previous ? 'Previous' : 'Current'} log of ${container.pod}/${container.container}: ${result.code}`
          )
          continue
        }
        diagnosis.logs.push({
          pod: container.pod,
          container: container.container,
          previous,
          ...logExcerpt(result.out)
        } satisfies LogExcerpt)
      }
    }
  }
  return diagnosis
}
