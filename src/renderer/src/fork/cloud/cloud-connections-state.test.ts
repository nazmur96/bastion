import { describe, expect, it, vi } from 'vitest'
import { CloudConnectionsState } from './cloud-connections-state'
import type {
  CloudTargetResult,
  CloudTargetsApi
} from '../../../../shared/fork-cloud/cloud-target-contract'
function result(projectId = 'project', revision = 0): CloudTargetResult {
  return {
    ok: true,
    snapshot: {
      namespaceId: 'workspace',
      projectId,
      revision,
      owner: 'local',
      targets: [],
      selection: null
    }
  }
}
function fixture() {
  const api: CloudTargetsApi = {
    read: vi.fn(async (id) => result(id)),
    update: vi.fn(async () => result('project', 1)),
    onChanged: () => () => {}
  }
  return { api, state: new CloudConnectionsState(() => api) }
}
describe('shared cloud connections state', () => {
  it('fences late responses after project switches and namespace exit', async () => {
    const { api, state } = fixture()
    let finish: (value: CloudTargetResult) => void = () => {}
    vi.mocked(api.read).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    const old = state.load('old', 'old-owner')
    await state.load('new', 'new-owner')
    finish(result('old'))
    await old
    expect(state.getSnapshot().snapshot?.projectId).toBe('new')
    const pending = state.load('project', 'current')
    state.clear()
    await pending
    expect(state.getSnapshot().snapshot).toBeNull()
  })
  it('reconciles change events during its own mutation without losing successful submission', async () => {
    const { api, state } = fixture()
    await state.load('project', 'scope')
    vi.mocked(api.update).mockImplementation(async () => {
      state.changed('project', 'scope')
      return result('project', 1)
    })
    expect(await state.update({ selection: null })).toBe(true)
    await vi.waitFor(() => expect(state.getSnapshot().pending).toBe(false))
    expect(api.read).toHaveBeenCalledTimes(2)
  })
  it('refreshes a stale writer and keeps a readable conflict message', async () => {
    const { api, state } = fixture()
    await state.load('project', 'scope')
    vi.mocked(api.update).mockResolvedValue({
      ok: false,
      code: 'conflict',
      message: 'Cloud targets changed. Refresh and try again.'
    })
    expect(await state.update({ selection: null })).toBe(false)
    expect(state.getSnapshot().error).toContain('Refresh')
  })
})
