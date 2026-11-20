import { describe, expect, it } from 'vitest'
import { RealAwsFailure } from '../../../shared/fork-cloud/real-aws-contract'
import { readRealAwsBackups } from './real-aws-backups'
import type { RealAwsCall } from './real-aws-resources'

const NOW = Date.parse('2026-11-20T12:00:00Z')
const ago = (hours: number) => new Date(NOW - hours * 60 * 60 * 1000).toISOString()

describe('RDS backup evidence', () => {
  it('classifies retention, restorable point and the newest available snapshot', async () => {
    const calls: [string, Record<string, unknown>][] = []
    const call: RealAwsCall = async (operation, parameters) => {
      calls.push([operation, parameters])
      if (operation === 'rds-instances') {
        return parameters.Marker
          ? {
              DBInstances: [
                {
                  Id: 'stale',
                  Engine: 'mysql',
                  Retention: 3,
                  LatestRestorable: ago(30)
                }
              ]
            }
          : {
              DBInstances: [
                {
                  Id: 'good',
                  Engine: 'postgres',
                  Retention: 7,
                  LatestRestorable: ago(0.1)
                },
                {
                  Id: 'off',
                  Engine: 'postgres',
                  Retention: 0,
                  LatestRestorable: null
                },
                {
                  Id: 'creating',
                  Engine: 'postgres',
                  Retention: 1,
                  Status: 'creating'
                }
              ],
              Marker: 'next'
            }
      }
      return {
        DBSnapshots: [
          { Instance: 'good', Created: ago(20), Status: 'available' },
          { Instance: 'good', Created: ago(2), Status: 'available' },
          { Instance: 'good', Created: ago(1), Status: 'creating' }
        ]
      }
    }
    const backups = await readRealAwsBackups(call, NOW)
    expect(calls.map(([operation, parameters]) => [operation, parameters.Marker])).toEqual([
      ['rds-instances', undefined],
      ['rds-instances', 'next'],
      ['rds-snapshots', undefined]
    ])
    expect(backups.databases.map((db) => [db.id, db.status, db.detail, db.latestSnapshot])).toEqual(
      [
        ['good', 'verified', '7-day retention · restorable to within 0 hours', ago(2)],
        ['off', 'mismatch', 'automated backups are disabled', null],
        ['creating', 'unknown', 'no restorable point reported (creating)', null],
        ['stale', 'mismatch', 'latest restorable point is 30 hours old', null]
      ]
    )
    expect(backups.status).toBe('ok')
  })
  it('turns a denied read into an unknown status and rethrows session failures', async () => {
    const denied = await readRealAwsBackups(async () => {
      throw new RealAwsFailure('denied')
    }, NOW)
    expect([denied.status, denied.databases]).toEqual(['denied', []])
    await expect(
      readRealAwsBackups(async () => {
        throw new RealAwsFailure('cli-session-expired')
      }, NOW)
    ).rejects.toThrow(RealAwsFailure)
  })
})
