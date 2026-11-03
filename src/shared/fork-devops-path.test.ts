import { describe, expect, it } from 'vitest'
import { pathStages } from './fork-devops-path'

const none = {
  understood: false,
  localCluster: false,
  appRunning: false,
  gitops: false,
  hardened: false
}

describe('project path', () => {
  it('starts at understanding, and the unbuilt cloud stages are never next', () => {
    expect(pathStages(none).map((stage) => stage.state)).toEqual([
      'next',
      'todo',
      'todo',
      'todo',
      'todo',
      'coming',
      'coming'
    ])
  })

  it('reflects reality, not order: a running app counts even before understanding', () => {
    const stages = pathStages({ ...none, localCluster: true, appRunning: true })
    expect(stages.slice(0, 4).map((stage) => stage.state)).toEqual(['next', 'done', 'done', 'todo'])
  })

  it('has no next once every built stage is done', () => {
    const all = pathStages({
      understood: true,
      localCluster: true,
      appRunning: true,
      gitops: true,
      hardened: true
    })
    expect(all.some((stage) => stage.state === 'next')).toBe(false)
  })
})
