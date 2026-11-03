import { describe, expect, it } from 'vitest'
import {
  imageRepoName,
  imageTargets,
  localClusterOf,
  localDeploySteps
} from './fork-devops-local-deploy'

const rendered = `
apiVersion: apps/v1
kind: Deployment
metadata: { name: shop-web, namespace: shop }
spec:
  template:
    spec:
      containers:
        - { name: web, image: ghcr.io/team/shop:1.4.0 }
        - { name: proxy, image: envoyproxy/envoy:v1.31 }
---
apiVersion: apps/v1
kind: StatefulSet
metadata: { name: postgres }
spec:
  template:
    spec:
      containers:
        - { name: db, image: postgres:16 }
---
apiVersion: v1
kind: Service
metadata: { name: shop-web }
`

describe('local deploy', () => {
  it('names images by their last path segment', () => {
    expect(imageRepoName('ghcr.io/team/shop-api:1.2@sha256:abc')).toBe('shop-api')
  })

  it('targets only the containers that run this app image', () => {
    expect(imageTargets(rendered, 'shop')).toEqual([
      {
        kind: 'Deployment',
        name: 'shop-web',
        namespace: 'shop',
        container: 'web',
        image: 'ghcr.io/team/shop:1.4.0'
      }
    ])
  })

  it('falls back to the only workload when no image name matches', () => {
    const one =
      'kind: Deployment\nmetadata: { name: api }\nspec: { template: { spec: { containers: [{ name: api, image: x/y:1 }] } } }\n'
    expect(imageTargets(one, 'shop')).toHaveLength(1)
    expect(imageTargets(rendered, 'unknown')).toEqual([])
  })

  it('reads kind and k3d contexts and nothing else', () => {
    expect(localClusterOf('kind-shop-dev')).toEqual({ tool: 'kind', name: 'shop-dev' })
    expect(localClusterOf('k3d-shop')).toEqual({ tool: 'k3d', name: 'shop' })
    expect(localClusterOf('vcluster-docker_shop')).toBeNull()
  })

  it('builds, loads, applies and retargets without editing the repo', () => {
    const steps = localDeploySteps({
      ok: true,
      image: 'shop:dev',
      dockerfile: 'Dockerfile',
      runtime: 'podman',
      cluster: { tool: 'kind', name: 'shop-dev' },
      source: { path: 'k8s/overlays/dev', kind: 'kustomize' },
      manifestsPath: '/w/shop',
      namespace: 'shop',
      targets: [
        { kind: 'Deployment', name: 'shop-web', namespace: 'shop', container: 'web', image: 'x' }
      ],
      paths: {
        dockerContext: '/w/shop',
        dockerfile: '/w/shop/Dockerfile',
        source: '/w/shop/k8s/overlays/dev',
        archive: '/tmp/shop.tar'
      }
    })
    expect(steps).toEqual([
      'podman build -t shop:dev -f "/w/shop/Dockerfile" "/w/shop"',
      'podman save shop:dev -o "/tmp/shop.tar"',
      'kind load image-archive "/tmp/shop.tar" --name shop-dev',
      'kubectl create namespace shop --dry-run=client -o yaml | kubectl apply -f -',
      'kubectl apply -n shop -k "/w/shop/k8s/overlays/dev"',
      'kubectl -n shop set image deployment/shop-web web=shop:dev',
      'kubectl -n shop rollout status deployment/shop-web --timeout=300s'
    ])
  })
})
