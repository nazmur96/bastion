import { describe, expect, it } from 'vitest'
import { cpuMilli, memoryMi, workloadMetrics } from './fork-devops-metrics'

const pods = JSON.stringify({
  items: [
    {
      metadata: {
        name: 'web-7d9f8b6c5d-abcde',
        namespace: 'shop',
        ownerReferences: [{ kind: 'ReplicaSet', name: 'web-7d9f8b6c5d' }]
      },
      status: { containerStatuses: [{ restartCount: 2 }] }
    },
    {
      metadata: {
        name: 'web-7d9f8b6c5d-fghij',
        namespace: 'shop',
        ownerReferences: [{ kind: 'ReplicaSet', name: 'web-7d9f8b6c5d' }]
      },
      status: { containerStatuses: [{ restartCount: 0 }] }
    },
    {
      metadata: {
        name: 'db-0',
        namespace: 'shop',
        ownerReferences: [{ kind: 'StatefulSet', name: 'db' }]
      },
      status: { containerStatuses: [{ restartCount: 1 }] }
    },
    { metadata: { name: 'loose', namespace: 'shop' }, status: {} }
  ]
})

const usage = JSON.stringify({
  items: [
    {
      metadata: { name: 'web-7d9f8b6c5d-abcde', namespace: 'shop' },
      containers: [{ usage: { cpu: '12000000n', memory: '32768Ki' } }]
    },
    {
      metadata: { name: 'web-7d9f8b6c5d-fghij', namespace: 'shop' },
      containers: [{ usage: { cpu: '8m', memory: '32Mi' } }]
    }
  ]
})

describe('workload metrics', () => {
  it('converts Kubernetes quantities', () => {
    expect(cpuMilli('250m')).toBe(250)
    expect(cpuMilli('1')).toBe(1000)
    expect(cpuMilli('1500000n')).toBe(1.5)
    expect(memoryMi('64Mi')).toBe(64)
    expect(memoryMi('131072Ki')).toBe(128)
    expect(memoryMi('1Gi')).toBe(1024)
  })

  it('sums pods into their Deployment and StatefulSet, keeping restarts without usage', () => {
    expect(workloadMetrics(pods, usage)).toEqual({
      'Deployment/shop/web': { cpuMilli: 20, memoryMi: 64, restarts: 2, pods: 2 },
      'StatefulSet/shop/db': { cpuMilli: 0, memoryMi: 0, restarts: 1, pods: 1 }
    })
  })

  it('survives bad input', () => {
    expect(workloadMetrics('nope', 'nope')).toEqual({})
  })
})
