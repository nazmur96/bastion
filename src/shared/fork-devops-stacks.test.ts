import { describe, expect, it } from 'vitest'
import { detectDevopsStacks, stackOfFile, stackOfWorkspaceFile } from './fork-devops-stacks'
import { rankDevopsActions } from './fork-devops-actions'

const MANIFEST = 'apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: podinfo\n'
const ARGO = 'apiVersion: argoproj.io/v1alpha1\nkind: Application\nmetadata:\n  name: podinfo\n'
const PLAYBOOK = '- hosts: all\n  tasks:\n    - name: ping\n      ping:\n'

function heads(map: Record<string, string>) {
  return (path: string): string | null => map[path] ?? null
}

describe('detectDevopsStacks', () => {
  it('finds each stack with evidence and the directories actions run in', () => {
    const files = [
      'infra/envs/dev/main.tf',
      'infra/envs/dev/.terraform.lock.hcl',
      'infra/modules/vpc/main.tf',
      'charts/podinfo/Chart.yaml',
      'charts/podinfo/templates/deployment.yaml',
      'kustomize/kustomization.yaml',
      'kustomize/deployment.yaml',
      'apps/podinfo.yaml',
      '.github/workflows/ci.yml',
      'Dockerfile',
      'compose.yaml',
      '.sops.yaml',
      'site.yml',
      'README.md'
    ]
    const findings = detectDevopsStacks(
      files,
      heads({
        'infra/envs/dev/main.tf': 'provider "aws" {\n  region = "eu-central-1"\n}\n',
        'kustomize/deployment.yaml': MANIFEST,
        'charts/podinfo/templates/deployment.yaml': MANIFEST,
        'apps/podinfo.yaml': ARGO,
        'site.yml': PLAYBOOK
      })
    )
    const byStack = Object.fromEntries(findings.map((finding) => [finding.stack, finding]))
    expect(findings.map((finding) => finding.stack)).toEqual([
      'terraform',
      'kubernetes',
      'helm',
      'argocd',
      'aws',
      'containers',
      'ci',
      'ansible',
      'secrets'
    ])
    expect(byStack.terraform.dirs).toEqual(['infra/envs/dev', 'infra/modules/vpc'])
    expect(byStack.helm.dirs).toEqual(['charts/podinfo'])
    expect(byStack.kubernetes.dirs).toEqual(['kustomize'])
    expect(byStack.aws.evidence).toEqual(['infra/envs/dev/main.tf'])
    expect(byStack.kubernetes.evidence).not.toContain('charts/podinfo/templates/deployment.yaml')
  })

  it('ignores YAML that is not a manifest, and finds nothing in an app-only repo', () => {
    expect(
      detectDevopsStacks(
        ['src/index.ts', 'config.yaml', 'package.json'],
        heads({ 'config.yaml': 'port: 8080\n' })
      )
    ).toEqual([])
  })

  it('caps evidence at three files', () => {
    const files = ['a.tf', 'b.tf', 'c.tf', 'd.tf']
    expect(detectDevopsStacks(files, () => null)[0].evidence).toHaveLength(3)
  })
})

describe('stackOfFile', () => {
  it('names the stack of the focused file', () => {
    expect(stackOfFile('infra/main.tf', null)).toBe('terraform')
    expect(stackOfFile('charts/podinfo/templates/hpa.yaml', MANIFEST)).toBe('helm')
    expect(stackOfFile('apps/podinfo.yaml', ARGO)).toBe('argocd')
    expect(stackOfFile('deploy/svc.yaml', MANIFEST)).toBe('kubernetes')
    expect(stackOfFile('.github/workflows/ci.yml', null)).toBe('ci')
    expect(stackOfFile('src/app.ts', null)).toBeNull()
  })
})

describe('rankDevopsActions', () => {
  const findings = detectDevopsStacks(
    ['infra/dev/main.tf', 'deploy/svc.yaml', 'charts/web/Chart.yaml'],
    heads({ 'deploy/svc.yaml': MANIFEST })
  )

  it('puts the focused file’s stack first and targets its directory', () => {
    const ranked = rankDevopsActions({
      findings,
      activeFile: { path: 'deploy/svc.yaml', stack: 'kubernetes' }
    })
    expect(ranked[0].action.stack).toBe('kubernetes')
    expect(ranked.map((item) => item.command)).toContain('kubectl diff -f deploy/svc.yaml')
    expect(ranked.find((item) => item.action.id === 'terraform.plan')?.command).toBe(
      'terraform -chdir=infra/dev plan'
    )
  })

  it('offers only actions for stacks that are present, never one that changes infrastructure', () => {
    const ranked = rankDevopsActions({ findings })
    expect(
      ranked.every((item) => ['terraform', 'kubernetes', 'helm'].includes(item.action.stack))
    ).toBe(true)
    expect(ranked.some((item) => /\b(apply|destroy|delete)\b/.test(item.command))).toBe(false)
    // No focused manifest: the file diff does not apply.
    expect(ranked.some((item) => item.action.id === 'kubernetes.diff')).toBe(false)
  })

  it('runs a chart action from the chart root when a template is focused', () => {
    const ranked = rankDevopsActions({
      findings,
      activeFile: { path: 'charts/web/templates/deploy.yaml', stack: 'helm' }
    })
    expect(ranked[0].command).toBe('helm lint charts/web')
  })
})

describe('stackOfWorkspaceFile', () => {
  const findings = detectDevopsStacks(
    ['charts/web/Chart.yaml', 'deploy/svc.yaml', 'apps/web.yaml'],
    (path) => (path === 'deploy/svc.yaml' ? MANIFEST : path === 'apps/web.yaml' ? ARGO : null)
  )

  it('places YAML by the workspace’s findings', () => {
    expect(stackOfWorkspaceFile('charts/web/values-prod.yaml', findings)).toBe('helm')
    expect(stackOfWorkspaceFile('apps/web.yaml', findings)).toBe('argocd')
    expect(stackOfWorkspaceFile('deploy/other.yaml', findings)).toBe('kubernetes')
    expect(stackOfWorkspaceFile('src/main.go', findings)).toBeNull()
  })
})

describe('kustomize action', () => {
  it('renders the overlay holding the open file, else the first overlay', () => {
    const findings = detectDevopsStacks(
      ['deploy/overlays/dev/kustomization.yaml', 'deploy/overlays/prod/kustomization.yaml'],
      () => null
    )
    const render = (path?: string) =>
      rankDevopsActions({
        findings,
        activeFile: path ? { path, stack: 'kubernetes' } : undefined
      }).find((item) => item.action.id === 'kubernetes.kustomize')?.command
    expect(render('deploy/overlays/prod/patch.yaml')).toBe('kubectl kustomize deploy/overlays/prod')
    expect(render('README.md')).toBe('kubectl kustomize deploy/overlays/dev')
  })
})
