import { describe, expect, it } from 'vitest'
import {
  argoAppName,
  argoApplicationYaml,
  argoDeploySteps,
  argoSources,
  httpsRepoUrl
} from './fork-devops-argo-deploy'

describe('argo deploy', () => {
  it('rewrites ssh remotes to https and rejects local paths', () => {
    expect(httpsRepoUrl('git@github.com:team/shop.git')).toBe('https://github.com/team/shop.git')
    expect(httpsRepoUrl('ssh://git@gitlab.com:2222/team/shop.git')).toBe(
      'https://gitlab.com/team/shop.git'
    )
    expect(httpsRepoUrl('https://github.com/team/shop')).toBe('https://github.com/team/shop')
    expect(httpsRepoUrl('/home/me/shop')).toBeNull()
  })

  it('prefers a dev overlay over its base, then charts, then plain manifest dirs', () => {
    const files = [
      'k8s/base/kustomization.yaml',
      'k8s/overlays/dev/kustomization.yaml',
      'k8s/overlays/prod/kustomization.yaml',
      'charts/shop/Chart.yaml',
      'charts/shop/charts/redis/Chart.yaml',
      'deploy/web.yaml'
    ]
    expect(argoSources(files, ['k8s/base', 'deploy'])).toEqual([
      { path: 'k8s/overlays/dev', kind: 'kustomize' },
      { path: 'k8s/overlays/prod', kind: 'kustomize' },
      { path: 'k8s/base', kind: 'kustomize' },
      { path: 'charts/shop', kind: 'helm' },
      { path: 'deploy', kind: 'directory' }
    ])
  })

  it('names apps the way Kubernetes accepts', () => {
    expect(argoAppName('My_Shop.App')).toBe('my-shop-app')
  })

  it('writes an automated, self-healing Application; plain dirs recurse', () => {
    const yaml = argoApplicationYaml({
      name: 'shop',
      repoURL: 'https://github.com/team/shop.git',
      revision: 'main',
      source: { path: 'deploy', kind: 'directory' },
      namespace: 'shop'
    })
    expect(yaml).toContain('path: "deploy"')
    expect(yaml).toContain('recurse: true')
    expect(yaml).toContain('selfHeal: true')
    expect(yaml).toContain('- CreateNamespace=true')
  })

  it('installs Argo CD only when missing and never needs base64', () => {
    const fresh = argoDeploySteps({ argoInstalled: false, appFile: '/tmp/a.yaml', name: 'shop' })
    const reuse = argoDeploySteps({ argoInstalled: true, appFile: '/tmp/a.yaml', name: 'shop' })
    expect(fresh[0]).toMatch(/^helm install argocd /)
    expect(reuse.some((step) => step.startsWith('helm'))).toBe(false)
    expect([...fresh, ...reuse].join(' ')).not.toContain('base64 -d')
    expect(fresh.join(' ')).not.toContain('helm upgrade')
  })
})
