import { describe, expect, it } from 'vitest'
import { parseK3dClusters, parseKindClusters, parseMultipassList } from './fork-devops-local-runs'

describe('local runs', () => {
  it('reads kind clusters, one per line', () => {
    expect(parseKindClusters('podinfo-dev\nshop-dev\n').map((run) => run.remove)).toEqual([
      'kind delete cluster --name podinfo-dev',
      'kind delete cluster --name shop-dev'
    ])
  })

  it('ignores kind messages and unsafe names', () => {
    expect(parseKindClusters('No kind clusters found.\nx; rm -rf /\n')).toEqual([])
  })

  it('reads k3d state from server counts', () => {
    const runs = parseK3dClusters(
      JSON.stringify([
        { name: 'a', serversRunning: 1, serversCount: 1 },
        { name: 'b', serversRunning: 0, serversCount: 1 }
      ])
    )
    expect(runs.map((run) => run.state)).toEqual(['running', 'stopped'])
  })

  it('reads multipass VMs and survives bad JSON', () => {
    expect(
      parseMultipassList(JSON.stringify({ list: [{ name: 'shop-vm', state: 'Running' }] }))
    ).toEqual([
      {
        kind: 'multipass',
        name: 'shop-vm',
        state: 'running',
        remove: 'multipass delete --purge shop-vm'
      }
    ])
    expect(parseMultipassList('oops')).toEqual([])
  })
})
