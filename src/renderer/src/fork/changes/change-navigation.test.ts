import { beforeEach, expect, it, vi } from 'vitest'
const m = vi.hoisted(() => ({ active: 'project-one', open: vi.fn() }))
vi.mock('@/store', () => ({ useAppStore: { getState: () => ({ activeWorktreeId: m.active }) } }))
vi.mock('../workspace-desktop/workspace-desktop-state', () => ({ openWorkspacePage: m.open }))
import {
  changeInitialIntent,
  changeInitialPaths,
  openChanges,
  openFileProposal
} from './change-navigation'
import { proposalDraft } from './proposal-drafts'
beforeEach(() => {
  m.active = 'project-one'
  vi.clearAllMocks()
})
it('keeps navigation seeds in their originating project and excludes sensitive paths', () => {
  openChanges('source', ['main.tf', 'credentials.json', '../a.json', 'main.tf'])
  expect(changeInitialPaths('project-one')).toEqual(['main.tf'])
  expect(changeInitialPaths('project-two')).toEqual([])
})
it('keeps proposal text and intent separate from another project', () => {
  openFileProposal('discovery', 'project-one', 'bastion.service.json', '{"fixture":true}')
  expect(changeInitialIntent('project-one')).toEqual({
    id: 'file:bastion.service.json',
    kind: 'create-file'
  })
  expect(changeInitialIntent('project-two').kind).toBe('source-check')
  expect(proposalDraft('project-one', 'bastion.service.json')).toBe('{"fixture":true}')
  expect(proposalDraft('project-two', 'bastion.service.json')).toBeUndefined()
  expect(m.open).toHaveBeenCalledWith('changes')
  openFileProposal('discovery', 'project-one', 'bastion.service.json', '{"regenerated":true}')
  expect(proposalDraft('project-one', 'bastion.service.json')).toBe('{"fixture":true}')
})
