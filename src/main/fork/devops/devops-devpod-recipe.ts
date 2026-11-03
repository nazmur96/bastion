import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  DEVPOD_RECIPE_DIR,
  DEVPOD_RECIPE_SCRIPTS,
  withDevpodRecipe
} from '../../../shared/fork-devops-devpod-recipe'

/** Adds the DevPod environment recipe to the repo; never overwrites an existing script. */
export function addDevpodRecipe(
  workspacePath: string
): { ok: true; files: string[] } | { ok: false; error: string } {
  const dir = join(workspacePath, DEVPOD_RECIPE_DIR)
  const clash = Object.keys(DEVPOD_RECIPE_SCRIPTS).find((name) => existsSync(join(dir, name)))
  if (clash) {
    return {
      ok: false,
      error: `${DEVPOD_RECIPE_DIR}/${clash} already exists; nothing was changed.`
    }
  }
  const orcaYamlPath = join(workspacePath, 'orca.yaml')
  const current = existsSync(orcaYamlPath) ? readFileSync(orcaYamlPath, 'utf8') : ''
  const next = withDevpodRecipe(current)
  if (next === null) {
    return { ok: false, error: 'orca.yaml already has a "devpod" environment recipe.' }
  }
  mkdirSync(dir, { recursive: true })
  const files: string[] = []
  for (const [name, body] of Object.entries(DEVPOD_RECIPE_SCRIPTS)) {
    const file = join(dir, name)
    writeFileSync(file, body)
    chmodSync(file, 0o755)
    files.push(`${DEVPOD_RECIPE_DIR}/${name}`)
  }
  writeFileSync(orcaYamlPath, next)
  return { ok: true, files: [...files, 'orca.yaml'] }
}
