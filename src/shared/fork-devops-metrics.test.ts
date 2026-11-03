import { describe, expect, it } from 'vitest'
import {
  costLabel,
  cpuMilli,
  memoryMi,
  requestedMonthlyCost,
  workloadMetrics
} from './fork-devops-metrics'

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
      'Deployment/shop/web': {
        cpuMilli: 20,
        memoryMi: 64,
        restarts: 2,
        pods: 2,
        cpuRequestMilli: 0,
        memoryRequestMi: 0
      },
      'StatefulSet/shop/db': {
        cpuMilli: 0,
        memoryMi: 0,
        restarts: 1,
        pods: 1,
        cpuRequestMilli: 0,
        memoryRequestMi: 0
      }
    })
  })

  it('prices requests at Fargate list prices, and says so when nothing is requested', () => {
    const base = { cpuMilli: 0, memoryMi: 0, restarts: 0, pods: 2 }
    // 2 pods × (500m, 1Gi): 1 vCPU + 2 GB → (0.04048 + 2 × 0.004445) × 730
    const cost = requestedMonthlyCost({ ...base, cpuRequestMilli: 1000, memoryRequestMi: 2048 })
    expect(cost?.toFixed(2)).toBe('36.04')
    expect(costLabel({ ...base, cpuRequestMilli: 0, memoryRequestMi: 0 })).toBe('no requests set')
    expect(costLabel({ ...base, cpuRequestMilli: 1000, memoryRequestMi: 2048 })).toBe(
      '≈ $36/mo · 1000m · 2048Mi'
    )
  })

  it('sums container requests per workload', () => {
    const withRequests = JSON.stringify({
      items: [
        {
          metadata: {
            name: 'api-0',
            namespace: 'shop',
            ownerReferences: [{ kind: 'StatefulSet', name: 'api' }]
          },
          spec: {
            containers: [
              { resources: { requests: { cpu: '250m', memory: '128Mi' } } },
              { resources: { requests: { cpu: '50m' } } }
            ]
          },
          status: {}
        }
      ]
    })
    expect(workloadMetrics(withRequests, '{}')['StatefulSet/shop/api']).toMatchObject({
      cpuRequestMilli: 300,
      memoryRequestMi: 128
    })
  })

  it('survives bad input', () => {
    expect(workloadMetrics('nope', 'nope')).toEqual({})
  })
})
