import { beforeEach, describe, expect, it, vi } from 'vitest'
import { applyChangeCommand } from '../../../../shared/fork-changes/change-lifecycle'
import {
  currentChangeReview,
  type ChangeRecord,
  type ChangeSnapshot
} from '../../../../shared/fork-changes/change-contract'
const m = vi.hoisted(
  (): {
    exists: boolean
    record: ChangeRecord | null
    next: number
    execute: ReturnType<typeof vi.fn>
  } => ({ exists: false, record: null, next: 0, execute: vi.fn() })
)
const scope = {
  projectId: 'fixture',
  root: '/remote-fixture',
  hostId: 'runtime:fixture',
  routeKey: 'fixture'
}
vi.mock('./source-check-owner', () => ({
  captureSourceCheckOwner: () => ({
    scope: {
      projectId: 'fixture',
      root: '/remote-fixture',
      hostId: 'runtime:fixture',
      routeKey: 'fixture'
    },
    context: { target: { kind: 'environment', environmentId: 'fixture' } },
    assertCurrent: () => {}
  })
}))
vi.mock('@/runtime/runtime-file-mutation-client', () => ({
  readRuntimeDirectory: async () => (m.exists ? [{ name: 'new.json', isSymlink: true }] : [])
}))
vi.mock('./owner-execution-client', () => ({
  pinOwnerSnapshot: async (_owner: unknown, snapshot: ChangeSnapshot) => ({
    ...snapshot,
    ownerRuntimeId: 'owner-one'
  }),
  executeReviewedOwnerRun: m.execute
}))
import {
  createSourceProposal,
  prepareSourceProposal,
  reviewSourceProposal,
  proposalSnapshot
} from './source-proposal-controller'
function current(): ChangeRecord {
  if (!m.record) {
    throw new Error('Missing test change')
  }
  return structuredClone(m.record)
}
beforeEach(() => {
  m.exists = false
  m.next = 0
  m.execute.mockReset()
  m.record = {
    id: 'change',
    revision: 0,
    scope,
    intent: { id: 'file:new.json', kind: 'create-file' },
    entrances: ['discovery'],
    validations: [],
    reviews: [],
    runs: []
  }
  vi.stubGlobal('window', {
    api: {
      changes: {
        command: async ({ revision, command }) => {
          if (!m.record || m.record.revision !== revision) {
            throw new Error('Stale test writer')
          }
          m.record = applyChangeCommand(m.record, command, `operation-${++m.next}`, m.next)
          return current()
        }
      }
    }
  })
})
async function reviewed(content = '{"private":"sentinel"}'): Promise<ChangeRecord> {
  return reviewSourceProposal(
    await prepareSourceProposal(current(), 'new.json', content),
    'new.json',
    content
  )
}
describe('source proposal handoff', () => {
  it('prepares and reviews metadata without executing or persisting proposal text', async () => {
    const record = await reviewed()
    expect(m.execute).not.toHaveBeenCalled()
    expect(JSON.stringify(record)).not.toContain('sentinel')
    m.execute.mockResolvedValue(record)
    await createSourceProposal(record, 'new.json', '{"private":"sentinel"}')
    expect(m.execute).toHaveBeenCalledTimes(1)
    expect(m.execute.mock.calls[0][3]).toBe('{"private":"sentinel"}')
  })
  it('invalidates changed proposals and refuses a destination introduced after review', async () => {
    let record = await reviewed()
    await expect(createSourceProposal(record, 'new.json', '{"edited":true}')).rejects.toThrow(
      'Proposal changed'
    )
    expect(currentChangeReview(current())).toBeUndefined()
    record = await reviewed()
    m.exists = true
    await expect(
      createSourceProposal(record, 'new.json', '{"private":"sentinel"}')
    ).rejects.toThrow('destination already exists')
    expect(currentChangeReview(current())).toBeUndefined()
    expect(m.execute).not.toHaveBeenCalled()
  })
  it('refuses nested, secret, reserved and invalid proposals without exposing their body', () => {
    for (const name of ['../new.json', 'dir/new.json', 'secrets.json', 'CON.json']) {
      expect(() => proposalSnapshot(name, '{}')).toThrow('filename')
    }
    expect(() => proposalSnapshot('new.json', '{"private":"do-not-show",')).toThrow(
      'proposed JSON is invalid'
    )
  })
})
