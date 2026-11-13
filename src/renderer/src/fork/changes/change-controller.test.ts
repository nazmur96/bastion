import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getDiskBaselineSignature } from '../../../../shared/disk-baseline-signature'
import { applyChangeCommand } from '../../../../shared/fork-changes/change-lifecycle'
import {
  currentChangeReview,
  type ChangeRecord,
  type ChangeSnapshot
} from '../../../../shared/fork-changes/change-contract'

type State = {
  host: string
  runtimeId: string
  files: Map<string, string>
  record: ChangeRecord | null
  sequence: number
  afterRead: (() => void) | undefined
  execute: ReturnType<typeof vi.fn>
}
const state = vi.hoisted((): State => ({
  host: 'runtime:fixture',
  runtimeId: 'owner-one',
  files: new Map(),
  record: null,
  sequence: 0,
  afterRead: undefined,
  execute: vi.fn()
}))
vi.mock('./source-check-owner', () => ({
  captureSourceCheckOwner: (projectId: string) => {
    const host = state.host
    const assertCurrent = (): void => {
      if (host !== state.host) {
        throw new Error('Owner changed')
      }
    }
    return {
      scope: { projectId, root: '/fixture', hostId: host, routeKey: host },
      assertCurrent,
      snapshot: async (paths: string[]): Promise<ChangeSnapshot> => {
        assertCurrent()
        const files = paths.sort().map((path) => {
          const text = state.files.get(path)
          if (text === undefined) {
            throw new Error('Missing source')
          }
          return { path, fingerprint: getDiskBaselineSignature(text) }
        })
        state.afterRead?.()
        assertCurrent()
        return { adapter: 'source-check/v1', files }
      }
    }
  }
}))
vi.mock('./owner-execution-client', () => ({
  pinOwnerSnapshot: async (_owner: unknown, snapshot: ChangeSnapshot) => ({
    ...snapshot,
    ownerRuntimeId: state.runtimeId
  }),
  executeReviewedOwnerRun: state.execute
}))
import {
  openProjectChange,
  prepareSourceChange,
  reviewSourceChange,
  runSourceChange
} from './change-controller'

beforeEach(() => {
  state.host = 'runtime:fixture'
  state.runtimeId = 'owner-one'
  state.files = new Map([['a.json', '{}']])
  state.record = null
  state.sequence = 0
  state.afterRead = undefined
  state.execute.mockReset()
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
  return reviewSourceChange(
    await prepareSourceChange(await openProjectChange('project', 'discovery'), ['a.json'])
  )
}

describe('reviewed source handoff', () => {
  it('invalidates persisted review after saved edits without sending an execution request', async () => {
    const record = await reviewed()
    state.files.set('a.json', '{"human":"edit"}')
    await expect(runSourceChange(record, () => {})).rejects.toThrow('Source changed')
    expect(state.execute).not.toHaveBeenCalled()
    expect(state.record && currentChangeReview(state.record)).toBeUndefined()
    expect(state.record?.runs).toHaveLength(0)
  })
  it('invalidates review when the owner runtime restarts with identical source', async () => {
    const record = await reviewed()
    state.runtimeId = 'owner-two'
    await expect(runSourceChange(record, () => {})).rejects.toThrow('Execution owner changed')
    expect(state.execute).not.toHaveBeenCalled()
    expect(state.record && currentChangeReview(state.record)).toBeUndefined()
  })
  it('refuses owner changes before and during source reads', async () => {
    const record = await reviewed()
    state.host = 'local'
    await expect(runSourceChange(record, () => {})).rejects.toThrow('owner or target changed')
    state.host = 'runtime:fixture'
    state.afterRead = () => {
      state.host = 'local'
    }
    await expect(runSourceChange(record, () => {})).rejects.toThrow('Owner changed')
    expect(state.execute).not.toHaveBeenCalled()
  })
  it('hands only the pinned source metadata to the owner adapter', async () => {
    state.files.set('a.json', '{"value":"private-sentinel"}')
    const record = await reviewed()
    state.execute.mockResolvedValue(record)
    await runSourceChange(record, () => {})
    expect(state.execute).toHaveBeenCalledTimes(1)
    const snapshot = state.execute.mock.calls[0][2]
    expect(snapshot.ownerRuntimeId).toBe('owner-one')
    expect(JSON.stringify(snapshot)).not.toContain('private-sentinel')
    expect(snapshot.files.map((file) => file.path)).toEqual(['a.json'])
  })
})
