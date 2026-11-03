import { describe, expect, it } from 'vitest'
import { parseOrcaYaml } from './orca-yaml'
import { DEVPOD_RECIPE_SCRIPTS, withDevpodRecipe } from './fork-devops-devpod-recipe'

describe('DevPod recipe', () => {
  it('adds a recipe Orca parses, keeping what was there', () => {
    const next = withDevpodRecipe('# team setup\nscripts:\n  setup: pnpm install\n')
    expect(next).toContain('# team setup')
    const parsed = parseOrcaYaml(next ?? '')
    expect(parsed?.scripts.setup).toBe('pnpm install')
    expect(parsed?.environmentRecipes?.[0]).toMatchObject({
      id: 'devpod',
      create: 'sh ./scripts/orca-vm/devpod-create.sh'
    })
  })

  it('appends to existing recipes and never adds itself twice', () => {
    const once =
      withDevpodRecipe(
        'environmentRecipes:\n  - id: cloud\n    name: Cloud\n    create: ./c.sh\n'
      ) ?? ''
    expect(parseOrcaYaml(once)?.environmentRecipes?.map((recipe) => recipe.id)).toEqual([
      'cloud',
      'devpod'
    ])
    expect(withDevpodRecipe(once)).toBeNull()
  })

  it('keeps stdout for the JSON result only', () => {
    expect(DEVPOD_RECIPE_SCRIPTS['devpod-create.sh']).toContain('--ide none')
    expect(DEVPOD_RECIPE_SCRIPTS['devpod-create.sh']).toMatch(/devpod up .*>&2/)
    expect(DEVPOD_RECIPE_SCRIPTS['devpod-create.sh']).toContain('"schemaVersion":1')
  })
})
