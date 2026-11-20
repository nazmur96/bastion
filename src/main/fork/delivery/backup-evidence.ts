import { z } from 'zod'
import type {
  BackupEvidence,
  BackupFinding,
  BackupsRequest
} from '../../../shared/fork-delivery/backup-contract'
import type { VerificationRun } from '../../../shared/fork-delivery/operations-contract'
import type { DeliveryDeps } from './delivery-chain'

export type BackupDeps = Pick<DeliveryDeps, 'kubectl'> & {
  runs: () => Promise<VerificationRun[]>
}
const HOUR = 60 * 60 * 1000
const applicationSchema = z.object({
  spec: z.object({
    destination: z.object({ namespace: z.string().optional() })
  })
})
const scope = {
  includedNamespaces: z.array(z.string()).nullish(),
  excludedNamespaces: z.array(z.string()).nullish()
}
const backupsSchema = z.object({
  items: z.array(
    z.object({
      metadata: z.object({
        name: z.string(),
        creationTimestamp: z.string().optional()
      }),
      spec: z.object(scope).optional(),
      status: z
        .object({
          phase: z.string().optional(),
          completionTimestamp: z.string().optional(),
          errors: z.number().optional()
        })
        .optional()
    })
  )
})
const schedulesSchema = z.object({
  items: z.array(
    z.object({
      metadata: z.object({ name: z.string() }),
      spec: z.object({
        schedule: z.string().optional(),
        paused: z.boolean().optional(),
        template: z.object(scope).optional()
      }),
      status: z
        .object({
          phase: z.string().optional(),
          lastBackup: z.string().optional()
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
/** Velero's own rule: no included list (or "*") means every namespace; exclusions win. */
function covers(
  spec:
    | {
        includedNamespaces?: string[] | null
        excludedNamespaces?: string[] | null
      }
    | undefined,
  namespace: string
): boolean {
  const included = spec?.includedNamespaces ?? []
  if (spec?.excludedNamespaces?.includes(namespace)) {
    return false
  }
  return included.length === 0 || included.includes('*') || included.includes(namespace)
}
const hoursAgo = (at: string, now: number) => Math.max(Math.floor((now - Date.parse(at)) / HOUR), 0)
function unreadable(label: string, result: { ok: boolean; code: string; out: string }): string {
  return `${label}: ${
    result.ok
      ? 'unexpected shape'
      : /doesn't have a resource type/.test(result.out)
        ? 'Velero not installed'
        : result.code
  }`
}

function latestBackup(
  items: z.infer<typeof backupsSchema>['items'],
  namespace: string,
  staleHours: number,
  now: number
): BackupFinding {
  const covering = items
    .filter((item) => covers(item.spec, namespace))
    .sort((a, b) =>
      (b.metadata.creationTimestamp ?? '').localeCompare(a.metadata.creationTimestamp ?? '')
    )
  const latest = covering[0]
  if (!latest) {
    return {
      subject: namespace,
      status: 'mismatch',
      detail: `no Velero backup covers ${namespace}`,
      at: null,
      source: 'Velero backups'
    }
  }
  const good = covering.find(
    (item) => item.status?.phase === 'Completed' && item.status.completionTimestamp
  )
  const subject = `velero/${(good ?? latest).metadata.name}`
  const source = 'Velero backups'
  if (!good?.status?.completionTimestamp) {
    return {
      subject,
      status: 'mismatch',
      detail: `no completed backup (latest ${latest.status?.phase ?? 'New'})`,
      at: null,
      source
    }
  }
  const at = good.status.completionTimestamp
  const hours = hoursAgo(at, now)
  const phase = latest.status?.phase ?? 'New'
  if (hours >= staleHours) {
    return {
      subject,
      status: 'mismatch',
      detail: `last completed ${hours} hours ago`,
      at,
      source
    }
  }
  if (latest !== good && /Failed/.test(phase)) {
    return {
      subject: `velero/${latest.metadata.name}`,
      status: 'mismatch',
      detail: `latest backup ${phase}${
        latest.status?.errors ? ` (${latest.status.errors} errors)` : ''
      }; last completed ${hours} hours ago`,
      at,
      source
    }
  }
  return {
    subject,
    status: 'verified',
    detail: `last completed ${hours} hours ago`,
    at,
    source
  }
}

function latestDrill(runs: VerificationRun[], drillDays: number, now: number): BackupFinding {
  const drill = runs
    .filter((run) => run.kind === 'drill' && run.runbook && /restore/.test(run.runbook))
    .sort((a, b) => b.at - a.at)[0]
  if (!drill) {
    return {
      subject: 'restore drill',
      status: 'mismatch',
      detail: 'no restore drill recorded',
      at: null,
      source: 'Verification runs'
    }
  }
  const days = Math.floor((now - drill.at) / (24 * HOUR))
  const at = new Date(drill.at).toISOString()
  const base = {
    subject: drill.runbook ?? 'restore drill',
    at,
    source: 'Verification runs'
  }
  if (!drill.passed) {
    return {
      ...base,
      status: 'mismatch',
      detail: `last restore drill failed ${days} days ago`
    }
  }
  return days >= drillDays
    ? {
        ...base,
        status: 'mismatch',
        detail: `last restore drill passed ${days} days ago`
      }
    : {
        ...base,
        status: 'verified',
        detail: `last restore drill passed ${days} days ago`
      }
}

/** Read-only backup evidence for the application's namespace, plus the latest restore drill. */
export async function readBackupEvidence(
  request: BackupsRequest,
  deps: BackupDeps,
  now = Date.now()
): Promise<BackupEvidence> {
  const unknown: string[] = []
  const backups: BackupFinding[] = []
  const schedules: BackupFinding[] = []
  const drill = latestDrill(await deps.runs(), request.drillDays, now)
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
    return {
      namespace,
      staleHours: request.staleHours,
      backups,
      schedules,
      drill,
      unknown,
      readAt: now
    }
  }
  const velero = (kind: string) =>
    deps.kubectl(['-n', request.veleroNamespace, 'get', kind, '-o', 'json'])
  const listed = await velero('backups.velero.io')
  const items = listed.ok ? parse(backupsSchema, listed.out)?.items : null
  if (items) {
    backups.push(latestBackup(items, namespace, request.staleHours, now))
  } else {
    unknown.push(unreadable(`Velero backups in ${request.veleroNamespace}`, listed))
  }
  const scheduled = await velero('schedules.velero.io')
  const scheduleItems = scheduled.ok ? parse(schedulesSchema, scheduled.out)?.items : null
  if (!scheduleItems) {
    unknown.push(unreadable(`Velero schedules in ${request.veleroNamespace}`, scheduled))
  }
  for (const item of (scheduleItems ?? []).filter((entry) =>
    covers(entry.spec.template, namespace)
  )) {
    const at = item.status?.lastBackup ?? null
    schedules.push({
      subject: `velero/${item.metadata.name}`,
      status: item.spec.paused
        ? 'mismatch'
        : item.status?.phase === 'Enabled'
          ? 'verified'
          : 'unknown',
      detail: item.spec.paused
        ? 'schedule paused'
        : `${item.spec.schedule ?? 'no cron'} · ${item.status?.phase ?? 'phase unknown'}${
            at ? ` · last backup ${hoursAgo(at, now)} hours ago` : ''
          }`,
      at,
      source: 'Velero schedules'
    })
  }
  if (scheduleItems && schedules.length === 0) {
    schedules.push({
      subject: namespace,
      status: 'mismatch',
      detail: `no Velero schedule covers ${namespace}`,
      at: null,
      source: 'Velero schedules'
    })
  }
  return {
    namespace,
    staleHours: request.staleHours,
    backups,
    schedules,
    drill,
    unknown,
    readAt: now
  }
}
