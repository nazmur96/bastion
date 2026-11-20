import { z } from 'zod'
import {
  RealAwsFailure,
  type RealAwsBackups,
  type RealAwsDatabaseBackup
} from '../../../shared/fork-cloud/real-aws-contract'
import type { RealAwsCall } from './real-aws-resources'

const HOUR = 60 * 60 * 1000
/** The newest restorable point may lag a few minutes; a day without one is a problem. */
export const RDS_STALE_HOURS = 26
const id = z.string().min(1).max(255)
const time = z.string().max(64).nullish()
const instance = z
  .object({
    Id: id,
    Engine: z.string().max(64).nullish(),
    Status: z.string().max(64).nullish(),
    Retention: z.number().int().nonnegative().nullish(),
    LatestRestorable: time
  })
  .passthrough()
const snapshot = z
  .object({
    Instance: id.nullish(),
    Created: time,
    Status: z.string().max(64).nullish()
  })
  .passthrough()
const fatal = [
  'cli-session-expired',
  'service-token-expired',
  'auth-unavailable',
  'identity-mismatch',
  'owner-changed',
  'tool-unavailable'
]

async function pages<T>(
  call: RealAwsCall,
  operation: 'rds-instances' | 'rds-snapshots',
  field: string,
  schema: z.ZodType<T>
): Promise<{ items: T[]; truncated: boolean }> {
  const items: T[] = []
  let marker: string | undefined
  for (let page = 0; page < 5; page++) {
    const response = z.record(z.string(), z.unknown()).parse(
      await call(operation, {
        MaxRecords: 100,
        ...(marker ? { Marker: marker } : {})
      })
    )
    items.push(...z.array(schema).parse(response[field] ?? []))
    const next = response.Marker
    if (next === null || next === undefined || next === '') {
      return { items, truncated: false }
    }
    marker = z.string().min(1).max(4096).parse(next)
  }
  return { items, truncated: true }
}

export function classifyDatabase(
  database: z.infer<typeof instance>,
  latestSnapshot: string | null,
  now: number
): RealAwsDatabaseBackup {
  const base = {
    id: database.Id,
    engine: database.Engine ?? 'unknown',
    retentionDays: database.Retention ?? null,
    latestRestorable: database.LatestRestorable ?? null,
    latestSnapshot
  }
  if (database.Retention === 0) {
    return {
      ...base,
      status: 'mismatch',
      detail: 'automated backups are disabled'
    }
  }
  const restorable = database.LatestRestorable ? Date.parse(database.LatestRestorable) : Number.NaN
  if (!Number.isFinite(restorable)) {
    return {
      ...base,
      status: 'unknown',
      detail: `no restorable point reported (${database.Status ?? 'status unknown'})`
    }
  }
  const hours = Math.floor((now - restorable) / HOUR)
  if (hours >= RDS_STALE_HOURS) {
    return {
      ...base,
      status: 'mismatch',
      detail: `latest restorable point is ${hours} hours old`
    }
  }
  return {
    ...base,
    status: 'verified',
    detail: `${database.Retention}-day retention · restorable to within ${Math.max(hours, 0)} hours`
  }
}

/** Step 14.4: RDS automated-backup and snapshot evidence for every database in the region. */
export async function readRealAwsBackups(
  call: RealAwsCall,
  now = Date.now()
): Promise<RealAwsBackups> {
  try {
    const instances = await pages(call, 'rds-instances', 'DBInstances', instance)
    const snapshots = await pages(call, 'rds-snapshots', 'DBSnapshots', snapshot)
    const newest = new Map<string, string>()
    for (const item of snapshots.items) {
      if (item.Instance && item.Created && item.Status === 'available') {
        const previous = newest.get(item.Instance)
        if (!previous || Date.parse(item.Created) > Date.parse(previous)) {
          newest.set(item.Instance, item.Created)
        }
      }
    }
    return {
      at: now,
      status: 'ok',
      databases: instances.items.map((database) =>
        classifyDatabase(database, newest.get(database.Id) ?? null, now)
      ),
      truncated: instances.truncated || snapshots.truncated
    }
  } catch (error) {
    if (error instanceof RealAwsFailure && fatal.includes(error.code)) {
      throw error
    }
    return {
      at: now,
      status: error instanceof RealAwsFailure ? error.code : 'unreadable',
      databases: [],
      truncated: false
    }
  }
}
