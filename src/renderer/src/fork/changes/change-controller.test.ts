import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getDiskBaselineSignature } from '../../../../shared/disk-baseline-signature'
import { applyChangeCommand } from '../../../../shared/fork-changes/change-lifecycle'
import type { ChangeRecord, ChangeSnapshot } from '../../../../shared/fork-changes/change-contract'
import type * as SourceOwner from './source-check-owner'

type TestState = {
  host: string
  current: boolean
  files: Map<string, string>
  reads: string[]
  record: ChangeRecord | null
  sequence: number
  afterRead: (() => void) | undefined
}

const state = vi.hoisted((): TestState => ({
  host: 'runtime:fixture',
  current: true,
  files: new Map<string, string>(),
  reads: [],
  record: null,
  sequence: 0,
  afterRead: undefined
}))
vi.mock('./source-check-owner', async (original) => {
  const real = await original<typeof SourceOwner>()
  return {
    ...real,
    captureSourceCheckOwner: (projectId: string) => {
      const host = state.host
      const assertCurrent = (): void => {
        if (!state.current || state.host !== host) {
          throw new Error('Owner changed')
        }
      }
      const read = async (path: string): Promise<string> => {
        assertCurrent()
        state.reads.push(`${host}:${path}`)
        const text = state.files.get(path)
        if (text === undefined) {
          throw new Error('Missing')
        }
        state.afterRead?.()
        assertCurrent()
        return text
      }
      return {
        scope: { projectId, root: '/remote-fixture', hostId: host, routeKey: host },
        assertCurrent,
        read,
        snapshot: async (paths: string[]): Promise<ChangeSnapshot> => ({
          adapter: 'source-check/v1',
          files: await Promise.all(
            [...paths].sort().map(async (path) => ({
              path,
              fingerprint: getDiskBaselineSignature(await read(path))
            }))
          )
        })
      }
    }
  }
})
import {
  openProjectChange,
  prepareSourceChange,
  reviewSourceChange,
  runSourceChange
} from './change-controller'

beforeEach(() => {
  state.host = 'runtime:fixture'
  state.current = true
  state.files = new Map([
    ['a.json', '{}'],
    ['b.json', '{']
  ])
  state.reads = []
  state.record = null
  state.sequence = 0
  state.afterRead = undefined
  vi.stubGlobal('window', {
    api: {
      changes: {
        ensure: async ({ scope, entrance }) =>
          (state.record ??= {
            id: 'change',
            revision: 0,
            scope,
            entrances: [entrance],
            validations: [],
            reviews: [],
            runs: []
          }),
        command: async ({ id, revision, command }) => {
          if (!state.record || state.record.id !== id || state.record.revision !== revision) {
            throw new Error('Revision conflict')
          }
          state.record = applyChangeCommand(
            state.record,
            command,
            `event-${++state.sequence}`,
            state.sequence
          )
          return structuredClone(state.record)
        }
      }
    }
  })
})
async function reviewed(): Promise<ChangeRecord> {
  const prepared = await prepareSourceChange(await openProjectChange('project', 'discovery'), [
    'a.json',
    'b.json'
  ])
  return reviewSourceChange(prepared)
}
describe('source check controller', () => {
  it('retains real partial failure evidence and source verification without source text', async () => {
    const record = await reviewed()
    const result = await runSourceChange(record, () => {})
    expect(result.runs[0]).toMatchObject({
      status: 'failed',
      steps: [
        { path: 'a.json', code: 'json-valid' },
        { path: 'b.json', code: 'json-invalid' }
      ],
      verification: { code: 'unchanged' }
    })
    expect(state.reads.every((path) => path.startsWith('runtime:fixture:'))).toBe(true)
    expect(JSON.stringify(result)).not.toContain('sourceText')
  })
  it('blocks execution after an edit and requires preparing and reviewing the new saved source', async () => {
    let record = await reviewed()
    state.files.set('b.json', '{}')
    await expect(runSourceChange(record, () => {})).rejects.toThrow('Source changed')
    expect(state.record?.runs).toHaveLength(0)
    record = await openProjectChange('project', 'source')
    record = await prepareSourceChange(record, ['a.json', 'b.json'])
    await expect(runSourceChange(record, () => {})).rejects.toThrow('Review')
    record = await reviewSourceChange(record)
    expect((await runSourceChange(record, () => {})).runs[0].status).toBe('passed')
  })
  it('does not retarget when the project host changes, including a change during the run', async () => {
    const record = await reviewed()
    state.host = 'local'
    await expect(runSourceChange(record, () => {})).rejects.toThrow('owner or target changed')
    state.host = 'runtime:fixture'
    const result = await runSourceChange(record, (next) => {
      if (next.runs[0].steps.length === 1) {
        state.host = 'local'
      }
    })
    expect(result.runs[0]).toMatchObject({
      status: 'failed',
      steps: [{ code: 'json-valid' }, { code: 'unavailable' }],
      verification: { code: 'unavailable' }
    })
    expect(state.reads.every((path) => path.startsWith('runtime:fixture:'))).toBe(true)
  })
  it('finishes on its original project when another view is opened', async () => {
    const record = await reviewed()
    const result = await runSourceChange(record, () => {})
    expect(result.scope.projectId).toBe('project')
    expect(result.runs[0].snapshot).toEqual(record.reviews[0].snapshot)
  })
})
