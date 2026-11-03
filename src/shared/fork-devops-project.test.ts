import { describe, expect, it } from 'vitest'
import { projectBase, proposeProject, type ProjectRepo } from './fork-devops-project'
import type { DevopsStack } from './fork-devops-stacks'

function repo(folder: string, stacks: DevopsStack[] = []): ProjectRepo {
  return {
    path: `/work/${folder}`,
    folder,
    remote: null,
    usesMise: false,
    findings: stacks.map((stack) => ({ stack, dirs: ['.'], evidence: [] }))
  }
}

describe('project detection', () => {
  it('strips role suffixes to find the shared name', () => {
    expect(projectBase('shop-gitops')).toBe('shop')
    expect(projectBase('Shop_Infra')).toBe('shop')
    expect(projectBase('platform')).toBeNull()
    expect(projectBase('podinfo')).toBe('podinfo')
  })

  it('groups the three-repo layout: app, <app>-gitops, bare platform', () => {
    const members = proposeProject(repo('podinfo', ['containers', 'kubernetes']), [
      repo('podinfo-gitops', ['argocd', 'kubernetes']),
      repo('platform', ['terraform']),
      repo('devsecops-template'),
      repo('other-app', ['containers'])
    ])
    expect(members.map((member) => `${member.repo.folder}:${member.role}`)).toEqual([
      'podinfo:app',
      'podinfo-gitops:gitops',
      'platform:platform'
    ])
  })

  it('finds the app from inside the gitops repo', () => {
    const members = proposeProject(repo('shop-gitops', ['argocd']), [
      repo('shop', ['containers']),
      repo('billing', ['containers'])
    ])
    expect(members.map((member) => member.repo.folder)).toEqual(['shop-gitops', 'shop'])
  })

  it('leaves a single repo alone', () => {
    expect(proposeProject(repo('shop', ['containers', 'terraform']), [repo('notes')])).toHaveLength(
      1
    )
  })
})
