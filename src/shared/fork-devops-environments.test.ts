import { describe, expect, it } from 'vitest'
import { contextTone, envWorkloads } from './fork-devops-environments'

describe('environments', () => {
  it('reads ready/desired and the image tag per workload', () => {
    const json = JSON.stringify({
      items: [
        {
          metadata: { name: 'web' },
          spec: {
            replicas: 3,
            template: { spec: { containers: [{ image: 'ghcr.io/team/shop:1.4.0' }] } }
          },
          status: { readyReplicas: 2 }
        },
        {
          metadata: { name: 'db' },
          spec: { template: { spec: { containers: [{ image: 'postgres:16' }] } } },
          status: {}
        }
      ]
    })
    expect(envWorkloads(json)).toEqual([
      { name: 'web', desired: 3, ready: 2, image: 'shop:1.4.0' },
      { name: 'db', desired: 1, ready: 0, image: 'postgres:16' }
    ])
    expect(envWorkloads('nope')).toEqual([])
  })

  it('tells local, real and production contexts apart', () => {
    expect(contextTone('kind-shop-dev')).toBe('local')
    expect(contextTone('eks-shop-prod')).toBe('prod')
    expect(contextTone('eks-shop-dev')).toBe('normal')
  })
})
