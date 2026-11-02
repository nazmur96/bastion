import { describe, expect, it } from 'vitest'
import { LAUNCHPAD_TILES, LAUNCHPAD_TOOLS, launchpadScript } from './fork-devops-launchpad'

function tile(id: string) {
  const found = LAUNCHPAD_TILES.find((candidate) => candidate.id === id)
  if (!found) {
    throw new Error(`no tile ${id}`)
  }
  return found
}

describe('launchpad', () => {
  it('fills the workspace name and chains steps', () => {
    expect(launchpadScript(tile('kind'), { name: 'shop', tfdir: '.' })).toBe(
      'kind create cluster --name shop-dev && kubectl cluster-info --context kind-shop-dev'
    )
  })

  it('points Terraform at the detected directory', () => {
    expect(launchpadScript(tile('terraform-plan'), { name: 'x', tfdir: 'infra' })).toContain(
      'terraform -chdir=infra plan'
    )
  })

  it('leaves sandbox tiles to the sandbox lifecycle', () => {
    expect(launchpadScript(tile('floci'), { name: 'x', tfdir: '.' })).toBeNull()
  })

  it('never creates billed resources from a click', () => {
    for (const real of LAUNCHPAD_TILES.filter((candidate) => candidate.group === 'real')) {
      expect(real.steps?.some((step) => /apply|--dry-run|plan|init/.test(step))).toBe(true)
      expect(real.steps?.some((step) => /\bapply\b/.test(step))).toBe(false)
    }
  })

  it('lists each tool once', () => {
    expect(new Set(LAUNCHPAD_TOOLS).size).toBe(LAUNCHPAD_TOOLS.length)
  })
})
