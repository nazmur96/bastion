import { describe, expect, it } from 'vitest'
import { buildSystemMap, downstreamOf, upstreamOf } from './fork-devops-system-map'

const items = [
  {
    kind: 'Ingress',
    metadata: { name: 'web', namespace: 'app' },
    spec: {
      rules: [
        { host: 'app.localhost', http: { paths: [{ backend: { service: { name: 'podinfo' } } }] } }
      ]
    }
  },
  {
    kind: 'Service',
    metadata: { name: 'podinfo', namespace: 'app' },
    spec: { selector: { app: 'podinfo' }, ports: [{ port: 9898 }] }
  },
  {
    kind: 'Service',
    metadata: { name: 'orphan', namespace: 'app' },
    spec: { selector: { app: 'gone' }, ports: [{ port: 80 }] }
  },
  {
    kind: 'Deployment',
    metadata: { name: 'podinfo', namespace: 'app' },
    spec: {
      replicas: 2,
      template: {
        metadata: { labels: { app: 'podinfo' } },
        spec: {
          containers: [
            { envFrom: [{ configMapRef: { name: 'podinfo' } }, { secretRef: { name: 'db' } }] }
          ],
          volumes: [{ configMap: { name: 'missing-cm' } }]
        }
      }
    },
    status: { readyReplicas: 1 }
  },
  { kind: 'ConfigMap', metadata: { name: 'podinfo', namespace: 'app' } },
  { kind: 'Deployment', metadata: { name: 'coredns', namespace: 'kube-system' }, spec: {} }
]
const map = buildSystemMap(JSON.stringify({ items }))
const node = (id: string) => map.nodes.find((candidate) => candidate.id === id)

describe('system map', () => {
  it('links ingress → service → workload → config', () => {
    expect(map.edges).toEqual(
      expect.arrayContaining([
        { from: 'Ingress/app/web', to: 'Service/app/podinfo' },
        { from: 'Service/app/podinfo', to: 'Deployment/app/podinfo' },
        { from: 'Deployment/app/podinfo', to: 'ConfigMap/app/podinfo' },
        { from: 'Deployment/app/podinfo', to: 'Secret/app/db' }
      ])
    )
  })

  it('flags half-ready workloads, selector-less services and missing config', () => {
    expect(node('Deployment/app/podinfo')).toMatchObject({ health: 'warn', detail: '1/2 ready' })
    expect(node('Service/app/orphan')?.health).toBe('warn')
    expect(node('ConfigMap/app/missing-cm')).toMatchObject({ health: 'bad', detail: 'missing' })
  })

  it('hides system namespaces and survives bad JSON', () => {
    expect(node('Deployment/kube-system/coredns')).toBeUndefined()
    expect(buildSystemMap('nope')).toEqual({ nodes: [], edges: [] })
  })

  it('walks blast radius both ways', () => {
    expect(upstreamOf(map, 'ConfigMap/app/podinfo')).toEqual(
      new Set(['Deployment/app/podinfo', 'Service/app/podinfo', 'Ingress/app/web'])
    )
    expect(downstreamOf(map, 'Ingress/app/web').has('Secret/app/db')).toBe(true)
  })
})
